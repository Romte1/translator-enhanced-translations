# Agent Instructions

This repository is the **data and automation plane** for Translator Enhanced. These rules are
mandatory for every change.

## Architecture

- Keep one Node.js data pipeline in this repository. Do not introduce microservices, queues or
  additional runtimes for translation work.
- Keep the flow layered: capture/queue input -> worker -> merge -> validation -> manifest.
- New orchestration code must accept its dependencies (fetch, filesystem paths, clock,
  tokens) as parameters or a small factory. Do not hide mutable clients in module scope.
- Dictionary files and `manifest.json` are the single source of truth. Do not create a second
  copy of a reviewed dictionary.

## Environments and security

- `dev` means a local clone, local pending files and worker runs with `LIMIT`; `prod` means
  the published `main` branch, the GitHub Actions queue and the Cloudflare collection API.
- Never run destructive scans, stress tests or audits against the collection service.
- Never commit `PENDING_TOKEN`, `LLM_API_KEY` or worker output containing player text.
- Translation changes go through a pull request; the worker must never mark texts as
  translated before the dictionary is merged.

## Testing and delivery

- Run `node scripts/validate-translations.mjs` before every merge.
- Regenerate `manifest.json` with `node scripts/update-manifest.mjs` after editing a dictionary.
- The collection API Playwright E2E suite lives in the plugin repository at `server/e2e`.
  This repository must not add browser infrastructure for a data-only pipeline.
- CI must remain: translate, mark translated, validate translations.

## Observability and hosting

- Use stdout/structured logs captured by GitHub Actions or Cloudflare. Do not add proprietary
  analytics SDKs.
- Hosting is Cloudflare + GitHub. AWS free tier is not part of this data pipeline; see the
  plugin repository's `docs/adr/0001-hosting.md`.

## Automation

- GitHub Actions proposes and validates changes. A human reviews translation PRs before merge.
- MCP may automate PR creation or inspection, but must not bypass review, secrets or branch
  protection.
- Keep the worker and validator usable locally without production credentials.
