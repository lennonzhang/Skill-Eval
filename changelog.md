# Changelog

All notable changes to Skill Eval are documented here. This file follows a release-notes style similar to the Claude Code changelog: newest entries first, short version headings, and grouped bullets for new features, improvements, fixes, and notes.

## Unreleased

### Coming soon

- Product Check calibration report comparing advisory Product Check output against human review scores.
- Cohort tagging and export workflows for deeper offline eval analysis.
- Disagreement queues for faster human-review workflows.

## 0.4.0 — 2026-05-19

### New features

- Added append-only review history with an `annotations` table. Each saved human review now creates a historical annotation while `evaluations` remains the latest review snapshot.
- Added sanitized `evaluation.save` audit events for review saves.
- Added per-item review history and audit timeline in the review workbench.
- Added browser-level reviewer identity without login. Each browser stores its reviewer id/display name locally and attaches it to review, exclusion, import, Product Check, and browser-cache mutations.
- Added a compact reviewer identity dialog for first-run setup and reviewer edits.
- Added `SKILL_EVAL_REVIEWER=id:name` as a server-level reviewer override that locks the UI identity when present.
- Added `/api/reviewer/me` for reading and updating the effective local reviewer.
- Added reviewer display in the top bar.
- Added batch source provenance fields: raw source digest, source byte size, normalized content digest, and import schema version.
- Added duplicate source-digest lookup and preflight warnings when a source JSON was already imported.
- Added `pnpm run eval:report -- --batch=<batch-id|latest>` for sanitized local batch report directories containing `report.json`, `summary.csv`, and a static `index.html`.
- Added `pnpm run eval:report:validate` and `pnpm run fixture:report:validate` for report schema, privacy, and fixture metric validation.
- Added `pnpm run eval:compare -- --batch=<id> --model-a=<model> --model-b=<model>` for sanitized model comparison reports.
- Added `pnpm run eval:compare:validate` for compare schema, privacy, and fixture metric validation.
- Added sanitized fixture coverage with `tests/fixtures/sanitized-resource.json` and `pnpm run smoke:fixture`.
- Added `SKILL_EVAL_RESOURCE_DIR` so tests can import fixture resources without reading real `resource/` data.
- Added `/api/health` test identity metadata so fixture smoke can verify it is talking to the intended temporary server.
- Added Playwright coverage for browser reviewer attribution and virtualized queue recovery.

### Improvements

- Moved review history and audit timeline to the top of the right-side evaluation panel, above scoring controls.
- Refreshed the top bar layout with separate context, primary action, and import action areas.
- Changed the language selector to a compact title-plus-select horizontal layout.
- Added compound review filters for score ranges, tag include/exclude, reviewer, Product Check delta, and cache state.
- Added keyboard-driven review shortcuts with an in-page shortcut help dialog.
- Show batch digest metadata in the top bar for faster provenance checks.
- Include annotation counts in batch delete plans.
- Hardened `pnpm run smoke:fixture` to allocate a dynamic localhost port, validate `/api/health` test identity, stop its temporary server, and remove its isolated data root.
- Extended `pnpm run smoke:fixture` to write deterministic fixture evaluations, generate a sanitized report, and validate expected model means, dimension means, tag counts, annotations, and sensitive-value exclusion.
- Extended `pnpm run smoke:fixture` to validate compound item filters and sanitized compare metrics.
- Encoded browser reviewer display names in request headers so non-ASCII names such as Chinese reviewer names are preserved safely.
- Keep audit payloads and reports sanitized by default: no prompt text, source URLs, result URLs, optimization prompts, uploaded JSON content, reviewer identities, reviewer comment bodies, raw source file names, or local image paths.
- Keep generated/local data ignored while allowing this changelog to be tracked under `docs/`.

### Fixes

- Fixed a virtualized queue race where the left item list could render an empty or stale window after scrolling away, using Current, then clicking a row.
- Fixed reviewer attribution gaps for browser-cache, archive/restore/delete, import, and Product Check mutation audit events.
- Hardened `/data/...` file serving so cached images and Product Check overlays are only returned when they match known batch/item records.

### Validation

- Passed `pnpm run check`.
- Passed `pnpm run selftest`.
- Passed `pnpm run smoke` with an isolated data root.
- Passed `pnpm run smoke:fixture`.
- Passed `pnpm run test:e2e`.
- Passed `pnpm run test:visual`.
- Cleaned Playwright test data with `pnpm run test:cleanup`.

### Notes

- Product Check remains advisory and does not write human evaluation scores.
- This release does not add login, sessions, OAuth, cloud storage, remote dashboards, or remote object storage.

## 0.3.0 — 2026-05-18

### New features

- Added batch Archive, Restore, and Delete actions for local batch lifecycle management.
- Added delete planning with explicit confirmation before local cleanup.
- Added soft Exclude and Restore for items that should remain traceable but not affect active statistics.
- Added exclude reasons: `internal_test`, `bad_input`, `duplicate`, `wrong_task`, `missing_image`, `not_evaluable`, and `other`.
- Added local audit events for batch lifecycle and item exclusion/restore actions.
- Added Product Check run metadata: algorithm version, threshold profile id, and threshold profile digest.
- Added threshold profile support for Product Check.
- Added Product Check metadata display in UI and CLI output.

### Improvements

- Excluded items remain visible in the queue, greyed out and sorted after active items.
- Active review statistics, tag counts, and default Product Check runs omit excluded items.
- Batch deletion only removes scoped local artifacts for the selected batch and never touches `resource/` or uploaded source JSON.

### Notes

- Deleting a batch is still a local-only cleanup flow and requires typing the exact batch id.

## 0.2.0 — Local review workbench

### New features

- Added the browser review workbench for imported image-generation batches.
- Added resource JSON import from `resource/*.json`.
- Added browser-selected local JSON upload import.
- Added import preflight with parse counts, model counts, duplicate detection, and digest validation.
- Added SQLite storage for batches, items, and human evaluation snapshots.
- Added local image caching under `data/cache/`.
- Added source/result image comparison.
- Added weighted six-dimension review rubric.
- Added issue tags and reviewer comments.
- Added batch progress, cache counts, per-model statistics, and tag statistics.
- Added URL-persisted workbench state for batch, item, model, status, search, language, and archived filters.
- Added virtualized queue rendering for large batches.
- Added Browser Cache fallback for images reachable by the browser but not Node fetch.
- Added task progress cards for import, browser cache, and Product Check jobs.

### Improvements

- Import and cache work use bounded worker pools for large batches.
- Import summaries and task snapshots avoid prompt text, remote URLs, and optimization prompt contents.

## 0.1.0 — Initial local eval foundation

### New features

- Added the local-first Node server for Skill Eval.
- Added the initial JSON data contract for model/provider, original prompt, source image URL, optimized prompt, and result image URL.
- Added the local Python Product Check prototype for product-preservation checks.
- Added Product Check visual artifacts including source masks, matched result regions, and diff heatmaps.
- Added Product Check selftests.
- Added JavaScript selftests and smoke checks.
- Added Playwright e2e coverage for workbench state, queue behavior, exclusion flow, and layout stability.
- Added test isolation with `SKILL_EVAL_DATA_DIR`.
- Added residue cleanup/check scripts for test-generated data.

### Notes

- Runtime data is local by default under ignored roots such as `data/`, `.tmp/`, reports, cache, import summaries, Product Check outputs, and Playwright artifacts.
- SQLite schema is maintained in `src/db.js` as the source of truth.
- Human review is authoritative; automated checks are advisory.
