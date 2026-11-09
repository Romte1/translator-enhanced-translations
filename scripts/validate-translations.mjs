#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const translations = join(root, "translations");
const types = ["interface", "menu_entry_option"];
const errors = [];

const DYNAMIC_MENU = [
	/^Withdraw-[\d,]+$/,
	/^Deposit-[\d,]+$/,
	/^Buy: [\d,]+ x .+$/,
	/^Sell: [\d,]+ x .+$/,
	/^Default quantity: [\d,]+$/,
	/^Add friend .+$/,
	/^Add ignore .+$/,
	/^Buy [\d,]+$/,
	/^Sell [\d,]+$/,
	/^Withdraw [\d,]+$/,
	/^Deposit [\d,]+$/,
	/^Buy-[\d,]+$/,
	/^Sell-[\d,]+$/,
	/^Remove-[\d,]+$/,
	/^Take-[\d,]+$/
];

const REQUIRED_MENU_PATTERN_PREFIXES = [
	"re:^Withdraw-",
	"re:^Buy: ",
	"re:^Sell: ",
	"re:^Default quantity: ",
	"re:^Add friend ",
	"re:^Add ignore "
];

function fail(message) {
	errors.push(message);
}

function languages(type) {
	return readdirSync(join(translations, type))
		.filter(name => name.endsWith(".txt"))
		.map(name => name.slice(0, -4))
		.sort();
}

function readDictionary(type, language) {
	const file = join(translations, type, `${language}.txt`);
	const entries = [];
	const keys = new Set();

	for (const [index, raw] of readFileSync(file, "utf8").split(/\r?\n/).entries()) {
		const line = raw.replace(/^\uFEFF/, "");
		if (!line.includes(";")) {
			continue;
		}

		const separator = line.indexOf(";");
		const key = line.slice(0, separator);
		const value = line.slice(separator + 1);
		const where = `${type}/${language}:${index + 1}`;

		if (!keys.add(key)) {
			fail(`${where}: duplicate key: ${key}`);
		}
		if (value.trim().length === 0) {
			fail(`${where}: empty value for: ${key}`);
		}

		entries.push({ key, value, where });
	}

	return entries;
}

function tags(text) {
	return [...text.matchAll(/<[^>]*>/g)].map(match => match[0]);
}

function numbers(text) {
	return (text.match(/\d+/g) ?? []).join("");
}

function patterns(entries) {
	return entries
		.filter(entry => entry.key.startsWith("re:"))
		.map(entry => {
			let regex;
			try {
				regex = new RegExp(entry.key.slice(3));
			} catch (e) {
				fail(`${entry.where}: invalid pattern: ${entry.key}: ${e.message}`);
				return null;
			}

			const groups = regex.toString().match(/\((?!\?)/g)?.length ?? 0;
			for (const placeholder of entry.value.matchAll(/\$(\d+)/g)) {
				const group = Number(placeholder[1]);
				if (group < 1 || group > groups) {
					fail(`${entry.where}: pattern ${entry.key} uses $${group} but has ${groups} groups`);
				}
			}

			return { key: entry.key, regex };
		})
		.filter(Boolean);
}

function validateDictionary(type, language) {
	const entries = readDictionary(type, language);
	const compiled = patterns(entries);

	for (const entry of entries) {
		if (entry.key.startsWith("re:")) {
			continue;
		}

		if (JSON.stringify(tags(entry.key)) !== JSON.stringify(tags(entry.value))) {
			fail(`${entry.where}: tags differ for: ${entry.key}`);
		}

		const skipNumbers = type === "menu_entry_option"
			&& (entry.key.startsWith("Add friend ") || entry.key.startsWith("Add ignore "));
		if (!skipNumbers && JSON.stringify(numbers(entry.key)) !== JSON.stringify(numbers(entry.value))) {
			fail(`${entry.where}: numbers differ for: ${entry.key}`);
		}

		if (type === "menu_entry_option" && /^Buy: /.test(entry.key)) {
			fail(`${entry.where}: exact Buy entry should be a pattern: ${entry.key}`);
		}
		if (type === "menu_entry_option" && /^Sell: /.test(entry.key)) {
			fail(`${entry.where}: exact Sell entry should be a pattern: ${entry.key}`);
		}
		if (type === "menu_entry_option" && DYNAMIC_MENU.some(regex => regex.test(entry.key))) {
			fail(`${entry.where}: dynamic menu key should be a pattern: ${entry.key}`);
		}
	}

	if (type === "menu_entry_option") {
		for (const prefix of REQUIRED_MENU_PATTERN_PREFIXES) {
			if (!compiled.some(entry => entry.key.startsWith(prefix))) {
				fail(`menu_entry_option/${language}: missing pattern ${prefix}`);
			}
		}
	}

	if (type === "menu_entry_option" && language === "spanish") {
		const dictionary = new Map(entries.map(entry => [entry.key, entry.value]));
		for (const [key, value] of [
			["Empty", "Vaciar"],
			["Empty Dish", "Vaciar"],
			["Empty basket", "Vaciar cesta"],
			["Net", "Pescar con red"],
			["Bank", "Abrir banco"],
			["Exit", "Salir"],
			["View", "Ver"]
		]) {
			if (dictionary.get(key) !== value) {
				fail(`menu_entry_option/spanish: expected ${key} -> ${value}, got ${dictionary.get(key)}`);
			}
		}
	}
}

function validateManifest() {
	const file = join(root, "manifest.json");
	if (!existsSync(file)) {
		fail("manifest.json is missing");
		return;
	}

	const manifest = JSON.parse(readFileSync(file, "utf8"));
	if (manifest.schemaVersion !== 1) {
		fail(`manifest.json: unsupported schemaVersion ${manifest.schemaVersion}`);
	}
	if (!manifest.files || typeof manifest.files !== "object") {
		fail("manifest.json: files object is missing");
		return;
	}

	const expected = new Map();
	for (const type of types) {
		for (const language of languages(type)) {
			const relative = `translations/${type}/${language}.txt`;
			expected.set(relative, createHash("sha256")
				.update(readFileSync(join(root, relative)))
				.digest("hex"));
		}
	}

	for (const [relative, hash] of expected) {
		if (manifest.files[relative] !== hash) {
			fail(`manifest.json: hash mismatch for ${relative}`);
		}
	}
	for (const relative of Object.keys(manifest.files)) {
		if (!expected.has(relative)) {
			fail(`manifest.json: unexpected file ${relative}`);
		}
	}
}

for (const type of types) {
	for (const language of languages(type)) {
		validateDictionary(type, language);
	}
}
validateManifest();

if (errors.length > 0) {
	console.error(`Translation validation failed with ${errors.length} error(s):`);
	for (const error of errors) {
		console.error(`  - ${error}`);
	}
	process.exit(1);
}

console.log(`Validated ${types.length} dictionary types across ${languages("interface").length} languages.`);
