# Translator Enhanced translations

This repository is the source of truth for the **curated** Translator Enhanced
dictionaries: interface texts (journals, diaries, combat achievements) and right-click
menu options.

The plugin consumes these files at runtime. It validates the SHA-256 of every downloaded
file, caches the last valid copy and falls back to its bundled interface dictionary when
the network is unavailable.

## Layout

```text
manifest.json
translations/
  interface/<language>.txt
  menu_entry_option/<language>.txt
  overrides/<language>.txt
docs/
  translation-rules.md
  menu-entry-rules.md
scripts/
  translate-worker.mjs
  merge-translations.mjs
  mark-translated.mjs
  merge-captures.ps1
  update-manifest.mjs
  validate-translations.mjs
```

Each dictionary is `english key;translation`, one entry per line. Interface files keep the
original tags, numbers and line breaks. Menu files use `re:` patterns for dynamic options
such as `Withdraw-<n>`, `Buy: <n> x <item>`, `Default quantity: <n>` and
`Add friend <name>`.

## Updating translations

The automatic first pass runs in GitHub Actions:

1. It reads pending texts from the collection server.
2. It translates interface and menu texts with the LLM worker.
3. It merges the result, regenerates `manifest.json` and validates the dictionaries.
4. It opens or updates a pull request.

The worker needs these repository settings:

**Variables**

- `PENDING_URL`
- `LLM_BASE_URL`
- `LLM_MODEL`

**Secrets**

- `LLM_API_KEY`
- `PENDING_TOKEN`

Pushes to `main` also trigger the mark-translated workflow, which removes already merged
texts from the collection queue.

Run the validation locally with:

```bash
node scripts/validate-translations.mjs
```

Generate the manifest after a manual edit with:

```bash
node scripts/update-manifest.mjs
```

## Plugin

- Plugin repository: https://github.com/Romte1/translator-enhanced
- Collection server: https://github.com/Romte1/translator-enhanced/tree/master/server

The plugin keeps an older interface dictionary as an offline fallback. Menu options are
downloaded and cached.

## License

BSD-2-Clause. See [LICENSE](LICENSE).
