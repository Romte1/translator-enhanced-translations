# Translation pipeline

How reviewed translations are produced, from a player opening a window to a merged pull
request. The goal is **precision**: machine translation is never shipped unreviewed.

```
player opens a journal
        │
        ▼
WidgetTranslator ── exact match? ── yes ──► applies reviewed translation
        │ no
        ▼
InterfaceTextCapture ── dedupe + skip already known ──► local file + optional upload
        │
        ▼ (opt-in)
POST /api/v1/data-collection ──► collection server (dedupe, seen_count)
        │
        ▼
GET /api/v1/pending ──► worker (LLM + rules) ──► PR ──► CI ──► merge
        │
        ▼
clients download the dictionary on start
```

## 1. Client: only unique, only missing

`WidgetTranslator` only reaches the capture step when the text has **no** reviewed
translation (`TranslationStore.lookup` checks exact entries, the tag/break signature and
`re:` patterns first).

It then:

* keys every text by `<language, file, exact text>` so the same string is sent **once**;
* writes it to `~/.runelite/translator/untranslated/<lang>.txt` when
  `Journals -> Capture untranslated` is on;
* uploads it once per session when `General -> Enable text capture` is on (opt-in, warned);
* never captures quest/diary **titles** (they are names).

A text that already has a translation is never captured again, even across sessions.

## 2. Server: one row per unique text

`server/server.mjs` is a dependency-free Node service. Storage is two append-only jsonl
files, no database:

```
texts.jsonl       hash, type, text, count, first, last
translated.jsonl  hash
```

| Method | Path | Auth | Payload |
| --- | --- | --- | --- |
| `POST` | `/api/v1/data-collection` | rate limited | `[{"type":"interface","text":"..."}]` |
| `GET` | `/api/v1/pending?limit=500&type=interface&language=french` | bearer | sorted by `count` |
| `POST` | `/api/v1/translated` | bearer | `{"items":[{"type":"interface","text":"..."}]}` |
| `GET` | `/health` | none | counters |

The hash is `sha256(type + "\n" + text)`, so the same string from a thousand players is one
row with `count = 1000`. That count is the priority: the queue always starts with what most
players actually see, and nobody's client gets special treatment.

Privacy: no account, no player name, only the text, the type and the IP used for rate
limiting. The opt-in warning covers it.

Deployment (Railway/Fly/VPS) is in [server/README.md](../server/README.md).

## 3. Translation: machine first pass + human approval

`docs/translation-rules.md` holds the rules and the glossary. Menu options use
`docs/menu-entry-rules.md`. The worker (`scripts/translate-worker.mjs`) sends the rules plus
eight reviewed examples from the dictionary, and validates every answer:

1. keep proper nouns (NPCs, bosses, items, places, quest names) in english;
2. keep skill names in english (`Ranged`, `Cooking`...);
3. keep every `<col=...>`, `</col>`, `<br>`, `<str>` tag exactly where it is;
4. keep numbers, and remember `re:` entries use `$1`, `$2`;
5. keep the sentence structure of wrapped lines.

Tags and numbers are checked mechanically; a wrong line is discarded and retried alone.
Names, titles and requirement-only widgets are never sent. **It is not merged
automatically**: the PR is reviewed.

Each language has its own dictionary and its own queue view. The source texts are the same
for everyone, so one table feeds all of them; only the "translated" mark is per language.

`SEED_FROM=spanish` makes a run start from the keys of another dictionary. That is how the
other languages reach the same coverage as Spanish without waiting for a player to open every
screen: with `LIMIT`, each run fills a slice and the rest stays for the next one.

## 4. Queue and PR automation

`PENDING_URL` makes the worker read the aggregated queue instead of a local file:

```bash
PENDING_URL=https://<server>/api/v1/pending \
PENDING_TOKEN=... LLM_API_KEY=... node scripts/translate-worker.mjs french interface
```

Menu options use the same worker with the type as the third argument:

```bash
PENDING_URL=https://<server>/api/v1/pending \
PENDING_TOKEN=... LLM_API_KEY=... node scripts/translate-worker.mjs french menu_entry_option
```

The GitHub Action runs the same flow once per language (matrix, one job at a time) and opens
one rolling PR per language.

Marking is **never** done by the worker. A pull request can be reviewed, delayed or closed,
so removing texts from the queue before the dictionary has them would lose them. Instead
`.github/workflows/mark-translated.yml` runs after a merge to master and marks every key that
is now in the dictionary. The server only accepts hashes that already exist in its queue.

`.github/workflows/translate.yml` does the same on GitHub (manual or every Monday): fetch the
queue, translate, merge, `./gradlew build`, open a rolling PR. CI validates duplicate keys,
tags, numbers, placeholders and non-empty keys.

## 5. Distribution: no release per translation

The dictionary is bundled in the jar as a fallback, and the client also downloads it on
start when `Journals -> Download translations` is on:

```
bundled ──► online dictionary ──► user overrides ──► aliases
                │ fails: cached copy in ~/.runelite/translator/interface/
```

The address is a constant in `TranslatorAPI`, maintained by the project, not a user setting.
It points at the repository every client shares, not at a personal machine:

* `interface/` and `menu_entry_option/` are curated here and downloaded from this repository;
* `dialogue`, `npc`, `item` and `object` still come from `iolave/osrs-translations` until
  they are migrated too.

A downloaded file with fewer entries than the bundled one is ignored, so a stale branch can
never regress the plugin.

## 6. Local workflow (no server)

```powershell
# 1. enable "Journals: Capture untranslated" and open the screens
./scripts/merge-captures.ps1 -Language spanish
node scripts/translate-worker.mjs spanish
# 2. review build/translated-spanish.txt, then
node scripts/merge-translations.mjs spanish
# menu options
node scripts/translate-worker.mjs spanish menu_entry_option
node scripts/merge-translations.mjs spanish menu_entry_option
./gradlew build
```

`merge-captures.ps1` drops duplicates and everything that already has a translation, so the
pending file only contains unique new texts.
