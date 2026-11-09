#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const types = ["interface", "menu_entry_option"];
const files = {};

for (const type of types) {
	for (const name of readdirSync(join(root, "translations", type)).filter(name => name.endsWith(".txt")).sort()) {
		const path = join(root, "translations", type, name);
		const key = relative(root, path).replaceAll("\\", "/");
		files[key] = createHash("sha256").update(readFileSync(path)).digest("hex");
	}
}

const version = process.env.TRANSLATIONS_VERSION
	?? new Date().toISOString().replace(/\D/g, "").slice(0, 14);

const manifest = {
	schemaVersion: 1,
	version,
	files
};

writeFileSync(join(root, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(`wrote manifest ${version} with ${Object.keys(files).length} files`);
