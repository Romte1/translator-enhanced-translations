#!/usr/bin/env node
/*
 * Translates the pending interface texts with an LLM and writes the result to
 * build/translated-<language>.txt, ready to review and append to
 * translations/interface/<language>.txt.
 *
 * Usage:
 *   LLM_API_KEY=... node scripts/translate-worker.mjs spanish
 *
 * Environment:
 *   LLM_API_KEY   required
 *   LLM_BASE_URL  OpenAI compatible endpoint (default https://api.openai.com/v1)
 *   LLM_MODEL     model name (default gpt-4o-mini)
 *
 * The rules in docs/translation-rules.md are sent as the system prompt, and every
 * translation is validated (tags and numbers must match the english text) before it is
 * written. Nothing is merged automatically.
 */

import { readFileSync, appendFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const language = process.argv[2] ?? "spanish";
const type = process.argv[3] ?? "interface";
const dryRun = process.argv.includes("--dry-run");

const TYPES = new Set(["interface", "menu_entry_option"]);
if (!TYPES.has(type)) {
	console.error(`unknown dictionary type: ${type}`);
	process.exit(1);
}

loadEnvFile(join(root, ".env"));

const limit = Number(process.env.LIMIT ?? 0);
const batchSize = Number(process.env.BATCH_SIZE ?? 15);

const apiKey = process.env.LLM_API_KEY || "";
const baseUrl = (process.env.LLM_BASE_URL || "https://api.groq.com/openai/v1").replace(/\/$/, "");
const model = process.env.LLM_MODEL || "openai/gpt-oss-120b";

if (!apiKey && !dryRun) {
	console.error("LLM_API_KEY is required (put it in .env or the environment)");
	process.exit(1);
}

const pendingFile = join(root, "build",
	type === "interface" ? `pending-${language}.txt` : `pending-${type}-${language}.txt`);
const dictionaryFile = join(root, "translations", type, `${language}.txt`);
const outputFile = join(root, "build",
	type === "interface" ? `translated-${language}.txt` : `translated-${type}-${language}.txt`);

/**
 * Names and requirement-only widgets are never translated, so they are not sent.
 */
const IGNORED_PREFIXES = ["<col=7f0000>", "<col=800000>", "<col=ffffff>("];

const SKILLS = /\b(Attack|Strength|Defence|Ranged|Prayer|Magic|Runecraft|Construction|Hitpoints|Agility|Herblore|Thieving|Crafting|Fletching|Slayer|Hunter|Mining|Smithing|Fishing|Cooking|Firemaking|Woodcutting|Farming|Sailing)\b/g;

const inputFile = existsSync(pendingFile) ? pendingFile : join(root, "captures", `${language}.txt`);

if (!existsSync(inputFile) && !process.env.PENDING_URL) {
	console.error(`missing ${pendingFile} and captures/${language}.txt, run scripts/merge-captures.ps1 first`);
	process.exit(1);
}

const rules = readFileSync(
	join(root, "docs", type === "menu_entry_option" ? "menu-entry-rules.md" : "translation-rules.md"),
	"utf8");
const examples = type === "interface" ? pickExamples(language, 8) : [];
const systemPrompt = buildSystemPrompt(language, rules, examples, type === "menu_entry_option");
const known = new Set(
	readLines(dictionaryFile)
		.filter(line => line.includes(";"))
		.map(line => normalize(line.slice(0, line.indexOf(";"))))
);
const knownValues = new Set(
	readLines(dictionaryFile)
		.filter(line => line.includes(";"))
		.map(line => normalize(line.slice(line.indexOf(";") + 1)))
);
const knownPatterns = readLines(dictionaryFile)
	.filter(line => line.startsWith("re:") && line.includes(";"))
	.map(line => {
		try {
			return new RegExp(line.slice("re:".length, line.indexOf(";")));
		} catch {
			return null;
		}
	})
	.filter(pattern => pattern !== null);

const otherLanguageValues = language === "spanish"
	? new Set()
	: readValues(type, "spanish");

const sourceValues = readValues(type, "spanish");
const SPANISH_LABEL = /^(Monstruo|Tipo|Rango|Completado|Puntos totales|Descripción|Dificultad|Requisitos|Recomendaciones|Tareas|Filtros|Nivel de)\s*:/i;

const localTexts = existsSync(inputFile)
	? readLines(inputFile).map(line => line.slice(0, line.lastIndexOf(";")))
	: [];
const remoteTexts = process.env.PENDING_URL
	? await fetchPending(process.env.PENDING_URL, process.env.PENDING_TOKEN, language, type)
	: null;

if (remoteTexts !== null) {
	console.log(`collection server (${language}/${type}): ${remoteTexts.length} texts`);
}

const seedTexts = type === "interface" && process.env.SEED_FROM ? readSeed(process.env.SEED_FROM) : [];
if (seedTexts.length > 0) {
	console.log(`seed: ${seedTexts.length} keys from ${process.env.SEED_FROM}`);
}

const texts = remoteTexts ?? localTexts;

const pending = [...new Set([...texts, ...seedTexts])]
	.filter(key => key.length > 0 && !known.has(normalize(key)) && !knownValues.has(normalize(key)))
	.filter(key => !knownPatterns.some(pattern => pattern.test(key)))
	.filter(key => !IGNORED_PREFIXES.some(prefix => key.startsWith(prefix)))
	.filter(key => !SPANISH_LABEL.test(key))
	.filter(key => !(normalize(key).length > 12 && sourceValues.has(normalize(key))))
	.filter(type === "interface" ? looksLikeText : looksLikeMenuOption)
	.slice(0, limit > 0 ? limit : undefined);

if (pending.length === 0) {
	console.log("nothing pending");
	process.exit(0);
}

const existing = existsSync(outputFile) ? readLines(outputFile) : [];
const alreadyWritten = new Set(existing.map(line => line.slice(0, line.indexOf(";"))));
const todo = pending.filter(key => !alreadyWritten.has(key));

if (todo.length < pending.length) {
	console.log(`resuming: ${pending.length - todo.length} already in ${outputFile}`);
}

if (todo.length === 0) {
	console.log("nothing pending");
	process.exit(0);
}

const batches = Math.ceil(todo.length / batchSize);
console.log(`${todo.length} texts pending, ${batches} batches of ${batchSize}`);

if (dryRun) {
	console.log("\n--- system prompt ---\n");
	console.log(systemPrompt.slice(0, 900) + "\n...");
	console.log(`\n(${systemPrompt.length} chars, ${examples.length} reviewed examples)`);
	console.log("\n--- first batch ---\n");
	console.log(todo.slice(0, Math.min(5, batchSize)).map((text, index) => `${index + 1}|${text}`).join("\n"));
	console.log(`\n... ${batches} batches, nothing was sent`);
	process.exit(0);
}

mkdirSync(dirname(outputFile), { recursive: true });

let written = 0;
let usedTokens = 0;

for (let i = 0; i < todo.length; i += batchSize) {
	const batch = todo.slice(i, i + batchSize);
	let translated;

	try {
		translated = await translateBatch(batch);
	} catch (e) {
		if (String(e.message).includes("tokens per day")) {
			console.warn("daily token limit reached, keeping the results written so far");
			break;
		}

		throw e;
	}

	const lines = [];

	translated.forEach((value, index) => {
		if (value === null) {
			console.warn(`discarded (validation failed): ${batch[index]}`);
			return;
		}
		lines.push(`${batch[index]};${value}`);
		warnTranslatedSkills(batch[index], value);
	});

	appendFileSync(outputFile, lines.join("\n") + (lines.length > 0 ? "\n" : ""), "utf8");
	written += lines.length;
	console.log(`batch ${Math.ceil((i + 1) / batchSize)}/${batches}: ${lines.length}/${batch.length}`);
}

console.log(`wrote ${written} translations to ${outputFile} (${usedTokens} tokens)`);

async function fetchPending(url, token, language, type) {
	const response = await fetch(`${url}?limit=2000&type=${encodeURIComponent(type)}&language=${encodeURIComponent(language)}`, {
		headers: token ? { Authorization: `Bearer ${token}` } : {},
	});

	if (!response.ok) {
		throw new Error(`pending request failed: ${response.status} ${await response.text()}`);
	}

	const payload = await response.json();
	return (payload.texts ?? []).map(row => row.text).filter(text => typeof text === "string");
}

function readSeed(language) {
	const file = join(root, "translations", "interface", `${language}.txt`);

	return readLines(file)
		.filter(line => line.includes(";"))
		.map(line => line.slice(0, line.indexOf(";")))
		.filter(key => key.length > 0 && !key.startsWith("re:"));
}

function readValues(type, language) {
	const file = join(root, "translations", type, `${language}.txt`);

	return new Set(
		readLines(file)
			.filter(line => line.includes(";"))
			.map(line => normalize(line.slice(line.indexOf(";") + 1)))
	);
}


function loadEnvFile(file) {
	if (!existsSync(file)) {
		return;
	}

	for (const line of readFileSync(file, "utf8").split("\n")) {
		const match = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
		if (!match || process.env[match[1]] !== undefined) {
			continue;
		}
		process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
	}
}

async function translateBatch(batch) {
	const values = await requestTranslation(batch);

	for (let index = 0; index < values.length; index++) {
		if (values[index] === null) {
			values[index] = (await requestTranslation([batch[index]]))[0];
		}
	}

	return values;
}

async function requestTranslation(batch) {
	const budget = model.includes("qwen") ? 1000 : 4000;

	const body = JSON.stringify(Object.assign(
		{
			model,
			temperature: 0,
			max_tokens: Math.min(budget, 400 + batch.length * 120),
			messages: [
				{
					role: "system",
					content: systemPrompt,
				},
				{
					role: "user",
					content: batch.map((text, index) => `${index + 1}|${text}`).join("\n"),
				},
			],
		},
		model.includes("gpt-oss") ? { reasoning_effort: "low" } : {},
	));

	let response;
	for (let attempt = 1; ; attempt++) {
		response = await fetch(`${baseUrl}/chat/completions`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${apiKey}`,
			},
			body,
		});

		if (response.ok || (response.status !== 429 && response.status < 500) || attempt === 4) {
			break;
		}

		const wait = response.status === 429 ? 20000 * attempt : 2000 * attempt;
		console.warn(`retry ${attempt}/4 after ${response.status}, waiting ${wait / 1000}s`);
		await new Promise(resolve => setTimeout(resolve, wait));
	}

	if (!response.ok) {
		throw new Error(`LLM request failed: ${response.status} ${await response.text()}`);
	}

	const payload = await response.json();
	usedTokens += payload.usage?.total_tokens ?? 0;

	const finish = payload.choices?.[0]?.finish_reason;
	if (finish && finish !== "stop") {
		console.warn(`response cut off (${finish}), retrying the missing lines one by one`);
	}

	const content = payload.choices?.[0]?.message?.content ?? "";
	const byIndex = new Map();

	for (const raw of content.split("\n")) {
		const match = /^\s*(\d+)\s*\|(.*)$/.exec(raw);
		if (match) {
			byIndex.set(Number(match[1]), match[2].trim());
		}
	}

	return batch.map((key, index) => validate(key, byIndex.get(index + 1)));
}

/**
 * Same comparison the plugin uses as a last resort: tags and line breaks ignored, so a text
 * still matches after the game rewrapped it.
 */
function normalize(text) {
	return text.replace(/<[^>]*>/g, "").replace(/\s+/g, "");
}

/**
 * A text with no lowercase word is a name, a tier or a requirement chip, never a sentence:
 * "Ardougne", "Elf #2", "100 Museum Kudos". Those are not translated.
 */
function looksLikeText(key) {
	return key
		.replace(/<[^>]*>/g, " ")
		.split(/\s+/)
		.some(word => word.length > 0 && word === word.toLowerCase() && /\p{L}/u.test(word));
}

function looksLikeMenuOption(key) {
	return /[A-Za-z]/.test(key) && key.length <= 200;
}

function buildSystemPrompt(language, rules, examples, menu) {
	const exampleBlock = examples.length === 0
		? ""
		: "\n\n## Reviewed examples: English => " + language +
			"\n\nFollow this style exactly: names and items stay in English, tags are copied verbatim.\n\n" +
			examples.map(([source, target]) => `${source}\n=> ${target}`).join("\n\n");

	const keep = menu
		? "Translate every action using the action form of the target language; only leave item, NPC, place, skill and spell names unchanged."
		: "Translate every input: only return it unchanged when it is a proper name.";

	const ending = menu
		? "Do not leave an action in English."
		: "If a text is only a name, reply with the text unchanged.";

	return "You translate Old School RuneScape " +
		(menu ? "right-click menu options" : "interface texts") +
		` from English to ${language}.\n\n${rules}${exampleBlock}\n\n` +
		"Each input line starts with its index and a pipe: `index|english text`. " +
		"Reply with one line per input, keeping the same index and pipe: `index|translation`. " +
		"Output every index exactly once, even when two inputs are identical. " +
		keep + " " +
		"Do not repeat the original text, do not add explanations, do not use code fences. " +
		ending;
}

function pickExamples(language, count) {
	const file = join(root, "translations", "interface", `${language}.txt`);
	const candidates = readLines(file)
		.filter(line => line.includes(";"))
		.map(line => [line.slice(0, line.indexOf(";")), line.slice(line.indexOf(";") + 1)])
		.filter(([source, target]) =>
			source.length >= 20 && source.length <= 120 &&
			target.length > 0 && !target.startsWith("re:") &&
			(source.includes("<col=") || source.includes("<str>")) &&
			source !== target);

	if (candidates.length <= count) {
		return candidates;
	}

	const withSkills = candidates.filter(([source]) => source.match(SKILLS)?.length > 0).slice(0, 3);
	const rest = candidates.filter(candidate => !withSkills.includes(candidate));
	const remaining = count - withSkills.length;
	const step = (rest.length - 1) / Math.max(1, remaining - 1);

	for (let i = 0; i < remaining; i++) {
		withSkills.push(rest[Math.round(i * step)]);
	}

	return withSkills;
}

function warnTranslatedSkills(source, translation) {
	const names = new Set(source.match(SKILLS) ?? []);
	const missing = [...names].filter(name => !translation.includes(name));

	if (missing.length > 0) {
		console.warn(`skill name translated? ${missing.join(", ")}: ${source}`);
	}
}

function validate(source, translation) {
	if (!translation) {
		return null;
	}

	if (JSON.stringify(tags(source)) !== JSON.stringify(tags(translation))) {
		return null;
	}

	if (JSON.stringify(numbers(source)) !== JSON.stringify(numbers(translation))) {
		return null;
	}

	if (language !== "spanish" && translation.length > 25 && otherLanguageValues.has(normalize(translation))) {
		return null;
	}

	return translation;
}

function tags(text) {
	const found = [];
	const regex = /<[^>]*>/g;
	let match;
	while ((match = regex.exec(text)) !== null) {
		found.push(match[0]);
	}
	return found;
}

function numbers(text) {
	return (text.replace(/<[^>]*>/g, "").match(/\d+/g) ?? []).sort();
}

function readLines(file) {
	if (!existsSync(file)) {
		return [];
	}
	return readFileSync(file, "utf8")
		.replace(/^\uFEFF/, "")
		.split("\n")
		.map(line => line.trimEnd())
		.filter(line => line.length > 0 && !line.startsWith("#"));
}
