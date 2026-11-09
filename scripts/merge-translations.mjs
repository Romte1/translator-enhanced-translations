#!/usr/bin/env node
/*
 * Appends the reviewed worker output (build/translated-<language>.txt) to the interface
 * dictionary, skipping keys that are already covered.
 */

import { readFileSync, appendFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const language = process.argv[2] ?? "spanish";
const type = process.argv[3] ?? "interface";
const dictionaryFile = join(root, "translations", type, `${language}.txt`);
const translatedFile = join(root, "build",
	type === "interface" ? `translated-${language}.txt` : `translated-${type}-${language}.txt`);

if (!existsSync(translatedFile)) {
	console.log("nothing to merge");
	process.exit(0);
}

const signature = text => text.replace(/<[^>]*>/g, "").replace(/\s+/g, "");
const current = existsSync(dictionaryFile) ? readFileSync(dictionaryFile, "utf8") : "";
const keys = new Set(
	current.split(/\r?\n/)
		.filter(line => line.includes(";"))
		.map(line => signature(line.slice(0, line.indexOf(";"))))
);

const entries = [];

for (const line of readFileSync(translatedFile, "utf8").replace(/^\uFEFF/, "").split(/\r?\n/)) {
	const separator = line.indexOf(";");
	if (separator <= 0) {
		continue;
	}

	const key = line.slice(0, separator);
	const value = line.slice(separator + 1);

	if (!value || key === value || keys.has(signature(key))) {
		continue;
	}

	keys.add(signature(key));
	entries.push(`${key};${value}`);
}

if (entries.length === 0) {
	console.log("nothing new to merge");
	process.exit(0);
}

appendFileSync(dictionaryFile, (current.endsWith("\n") ? "" : "\n") + entries.join("\n") + "\n", "utf8");
console.log(`merged ${entries.length} entries into ${dictionaryFile}`);
