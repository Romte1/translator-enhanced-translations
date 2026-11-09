#!/usr/bin/env node
/*
 * Marks every text that is already in the dictionary as translated on the collection
 * server. Runs after a merge to master, never before: a pull request that is closed
 * without merging must not remove texts from the queue.
 */

import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const language = process.argv[2] ?? "spanish";
const type = process.argv[3] ?? "interface";
const pendingUrl = process.env.PENDING_URL;
const token = process.env.PENDING_TOKEN;

if (!pendingUrl) {
	console.log("PENDING_URL is not set, nothing to mark");
	process.exit(0);
}

const file = join(root, "translations", type, `${language}.txt`);
if (!existsSync(file)) {
	console.log(`no dictionary for ${language}, nothing to mark`);
	process.exit(0);
}

const endpoint = pendingUrl.replace(/\/pending$/, "/translated");
const texts = readFileSync(file, "utf8")
	.split(/\r?\n/)
	.filter(line => line.includes(";") && !line.trimStart().startsWith("#"))
	.map(line => line.slice(0, line.indexOf(";")))
	.filter(key => key.length > 0 && !key.startsWith("re:"))
	.map(key => ({ type, text: key }));

let marked = 0;

for (let i = 0; i < texts.length; i += 200) {
	const chunk = texts.slice(i, i + 200);
	const response = await fetch(endpoint, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			...(token ? { Authorization: `Bearer ${token}` } : {}),
		},
		body: JSON.stringify({ language, items: chunk }),
	});

	if (!response.ok) {
		console.error(`failed to mark translations: ${response.status} ${await response.text()}`);
		process.exit(1);
	}

	marked += chunk.length;
}

console.log(`marked ${marked} dictionary entries as translated`);
