# Skill Eval

Skill Eval is a local-first review tool for evaluating image-generation results after an agent uses a skill to optimize prompts. The first version focuses on one practical workflow: import a batch, cache images locally, review items manually, and inspect batch-level model statistics.

## Current Features

- Import task result JSON files from `resource/` or a browser-selected local JSON upload.
- Preflight each resource/upload JSON before import, including parse counts, model counts, duplicate count, source/content digests, and existing-batch digest warnings.
- Extract model, original prompt, source image URL, optimized prompt, and result image URL.
- Cache remote images under the local project folder at `data/cache/`.
- Store batches, items, append-only review annotations, and latest evaluation snapshots in SQLite at `data/app.sqlite`.
- Run a local Python product-consistency prototype against cached source/result images.
- Provide a local review UI with:
  - Batch selection.
  - Batch Archive/Restore/Delete for local batch lifecycle management.
  - Model and review-status filters.
  - Source/result image comparison.
  - Soft Exclude/Restore for items that should stay visible but leave active statistics.
  - Original and optimized prompt display.
  - Weighted score controls.
  - Issue tags and reviewer comments.
  - Reviewer identity display and per-item review history/audit timeline.
  - Batch progress and per-model statistics.

## Data Contract

The importer maps the task JSON into the review schema:

| Review field | JSON source |
| --- | --- |
| Model | `model` or `provider` |
| Original prompt | `text` or `params.content[].text` |
| Source image | `url` or `params.content[].url` |
| Optimized prompt | `optimizationPrompt` |
| Result image | `resultUrl` |

The current sample files are JSON arrays. In those files, the model field is `provider`, and the original prompt/source image are inside `params.content`.

## Commands

Use pnpm scripts:

```bash
pnpm run import:resource -- --file=<resource-file>.json
pnpm run eval:report -- --batch=<batch-id|latest>
pnpm run eval:report:validate -- --report=<data/reports/.../report.json>
pnpm run eval:compare -- --batch=<batch-id|latest> --model-a=<model> --model-b=<model>
pnpm run eval:compare -- --batch-a=<batch-id> --batch-b=<batch-id>
pnpm run eval:compare:validate -- --compare=<data/reports/.../compare.json>
pnpm run fixture:report:validate -- --report=<data/reports/.../report.json>
pnpm run dev
pnpm run serve
pnpm run test-env:reset
pnpm run test-env:reset:full
pnpm run test-env:start
pnpm run test-env:smoke
pnpm run service:start
pnpm run service:status
pnpm run service:stop
pnpm run service:restart
pnpm run check
pnpm run clear:evaluations -- --yes
pnpm run selftest
pnpm run review-utils:selftest
pnpm run smoke
pnpm run smoke:readonly
pnpm run smoke:fixture
pnpm run test:e2e
pnpm run test:residue
pnpm run test:cleanup
pnpm run product-check:selftest
pnpm run product-check -- --model gemini --batch latest --visualize
```

Command details:

- `pnpm run import:resource -- --file=<name.json>`: import one JSON from `resource/` as one batch and cache images unless `--no-images` is passed.
- `pnpm run eval:report -- --batch=<batch-id|latest>`: write a sanitized local report directory under `data/reports/` with `report.json`, `summary.csv`, and `index.html`. It includes batch digest provenance, rubric weights, aggregate stats, model dimension means, score buckets, tag counts, annotation counts, low-score rows, and optional Product Check disagreement rows. It excludes prompt text, URLs, optimized prompts, reviewer comments, reviewer identities, local image paths, and raw source file names.
- `pnpm run eval:report:validate -- --report=<path>`: validate the sanitized report structure and privacy boundary for a generated `report.json`.
- `pnpm run eval:compare -- --batch=<batch-id|latest> --model-a=<model> --model-b=<model>` or `pnpm run eval:compare -- --batch-a=<id> --batch-b=<id>`: write a sanitized model or batch comparison under `data/reports/` with aggregate score deltas, dimension deltas, tag deltas, paired win-rate metrics when rows can be matched by `import_key` or `raw_index`, and warnings when only aggregate comparison is available.
- `pnpm run eval:compare:validate -- --compare=<path>`: validate the sanitized compare structure and privacy boundary for a generated `compare.json`.
- `pnpm run fixture:report:validate -- --report=<path>`: validate a fixture-generated report against `tests/fixtures/expected/report-metrics.json` and confirm sanitized fixture prompts, URLs, optimized prompts, and reviewer comments did not leak into the report.
- Review UI local upload: choose a local `.json` with the same format as `resource/*.json`, then click Import Upload. The uploaded JSON is parsed into one batch but is not copied into `resource/`.
- `pnpm run dev`: start a one-off local review server in the foreground.
- `pnpm run serve`: start the same server with stable service semantics. `service:*` scripts use this command for the shared review service.
- `pnpm run test-env:reset`: rebuild `.tmp/test-env-data/` from the local Gemini resource JSON files without downloading images. This is the default deterministic development seed.
- `pnpm run test-env:reset:no-images`: explicit alias for the default no-image reset.
- `pnpm run test-env:reset:full`: rebuild `.tmp/test-env-data/` and download/cache images. Use this when validating image cache or visual behavior.
- `pnpm run test-env:start`: start the isolated test environment on `127.0.0.1:4174` with `.tmp/test-env-data/`.
- `pnpm run test-env:smoke`: run the writable API/page smoke checks against the test environment on port `4174`.
- `pnpm run service:start`: start the shared review service in the background on `127.0.0.1:4173` using real `data/`. Pass `-- -BindHost 0.0.0.0` only when LAN access is intentionally needed.
- `pnpm run service:stop`: stop only the process listening on the shared service port after identifying it.
- `pnpm run service:status`: show the shared service identity, port owner, health status, and log paths.
- `pnpm run service:restart`: stop and start the shared service. Use this only after test-environment validation passes.
- `pnpm run check`: syntax-check server, scripts, database/importer code, frontend JS, and Python product-check scripts.
- `pnpm run clear:evaluations -- --yes`: delete all local evaluation records. This is a local reset command and requires the explicit `--yes` guard.
- `pnpm run selftest`: validate scoring persistence and statistics inside a rollback transaction.
- `pnpm run review-utils:selftest`: validate URL-state helpers, task-card normalization, and virtual queue window math.
- `pnpm run smoke`: run API/page checks against a running local server. It creates and deletes a temporary upload batch to verify import, lifecycle, exclusion, and audit behavior.
- `pnpm run smoke:readonly`: run GET-only health checks against a running server. Use this for the real shared service.
- `pnpm run smoke:fixture`: start a temporary server on a dynamic local port, verify its `/api/health` test identity, run API smoke checks, import `tests/fixtures/sanitized-resource.json`, write fixed fixture evaluations through the API, generate `eval:report`, validate report schema/privacy/expected metrics, run residue checks in the isolated root, then stop the server and remove that data root.
- `pnpm run test:e2e`: run Playwright browser regressions against the review workbench.
- `pnpm run test:visual`: reserved Playwright visual subset; tests marked with `@visual` run here.
- `pnpm run test:residue`: check the active data root for `e2e-*`, `smoke-upload-*`, or `selftest-*` leftovers.
- `pnpm run test:cleanup`: remove the Playwright test data root. It refuses to delete any non-test data directory.
- `pnpm run product-check:selftest`: run synthetic OpenCV/skimage regression tests without using production data.
- `pnpm run product-check -- ...`: run advisory product-preservation checks against cached images.

Do not run `pnpm import`. That is a pnpm built-in command, not this project's data-import script.

## Exclude / Restore

Use Exclude when a row should remain traceable but should not affect review progress, model averages, tag counts, cache progress, or default Product Check runs. This is a soft state on the item, not a delete. The review queue still shows excluded rows, greyed out and sorted after active rows, so they can be inspected and restored later.

Supported exclude reasons are:

```text
internal_test
bad_input
duplicate
wrong_task
missing_image
not_evaluable
other
```

Storage stays in the SQLite source of truth in `src/db.js`: `items.excluded_at`, `items.exclude_reason`, and `items.exclude_note`. Existing evaluations are preserved when an item is excluded, but excluded items are omitted from active stats and `Next Unreviewed`. The Product Check CLI also omits excluded items by default; use `--include-excluded` only for explicit debugging.

## Batch Lifecycle

Use Archive when a batch should leave the default review list but remain recoverable. Archive only updates SQLite metadata on `batches.archived_at`, `batches.archive_reason`, and `batches.archive_note`; it does not delete items, evaluations, cached images, import summaries, Product Check outputs, `resource/`, or uploaded source files.

Use Delete only for local cleanup of a batch that should be removed from the tool. Delete first builds a delete plan, then requires the exact batch id as confirmation. It removes the batch row from SQLite, lets foreign keys delete its items and evaluations, and only removes these local artifact paths:

```text
data/cache/<batchId>/
data/import-runs/<batchId>.json
data/product-checks/<batchId>/
```

Delete never touches `resource/`, uploaded source JSON files, other batch directories, or paths outside `data/`.

## Image Cache Proxy

The importer first tries to cache each remote image through Node's normal fetch path. If that path fails and a proxy is configured, it retries through the configured HTTP proxy. This is useful when a browser can open the image URL because a browser VPN extension is active, but `pnpm run import:resource` cannot reach the same host from the terminal.

Preferred local setting:

```powershell
$env:SKILL_EVAL_FETCH_PROXY="http://127.0.0.1:<proxy-port>"
$env:SKILL_EVAL_FETCH_TIMEOUT_MS="180000"
$env:SKILL_EVAL_CACHE_WORKERS="4"
pnpm run import:resource -- --file=<resource-file>.json --cache-workers=4
```

Notes:

- `SKILL_EVAL_FETCH_PROXY` may contain one or more HTTP proxy URLs separated by commas, semicolons, or spaces. The importer tries them in order.
- `HTTPS_PROXY`, `HTTP_PROXY`, and `ALL_PROXY` are also recognized as fallbacks. `SKILL_EVAL_FETCH_PROXY` takes priority and is attempted before direct fetch.
- `NO_PROXY` is respected for environment proxies. Explicit `SKILL_EVAL_FETCH_PROXY` is still allowed because it is intended as a per-project override.
- Browser VPN extensions do not automatically apply to Node. The extension must expose a local HTTP proxy port, or the terminal import process still cannot use that route.
- Cache failures are stored per image in SQLite as `source_fetch_error` or `result_fetch_error` and include the attempted path, such as direct fetch or proxy fetch.
- Image caching uses a bounded worker pool. `SKILL_EVAL_CACHE_WORKERS` or `--cache-workers=<n>` controls how many item cache jobs run at once; use `1` for serial troubleshooting.
- In the review UI, failed images also have a Browser Cache fallback. If the current browser can read the remote image through its extension/VPN path and the remote host allows page fetch access, the page uploads the image blob back to the local server. The server persists it under `data/cache/` and updates SQLite, so the cache is available after refresh and for Product Check.
- When a batch is opened, the UI automatically attempts Browser Cache once per failed source/result image in the current browser session. It runs with small concurrency, updates only the task progress strip while running, and recomputes batch cache counts once after a successful batch of browser uploads.

## Task Progress

The review UI shows compact progress cards for long-running local work:

- Import: started by Import Resource or Import Upload, runs in the local server, and reports parsed, inserted, duplicate, source-cache, result-cache, and cache-failure counts.
- Browser Cache: started by the page when a batch has failed source/result images. The browser fetches the remote image, then uploads the blob back to the local server. The local server writes `data/cache/` and updates SQLite.
- Product Check: started by Run Product Check, runs as a Python child process, and reports checked, unsupported, failed, current item, and summary counts.

The task API is intentionally local progress metadata:

```text
GET /api/tasks/<taskId>
GET /api/tasks/latest?type=import
```

Task snapshots are written under `data/task-runs/`. They do not include prompt text, source URLs, result URLs, or optimization prompts. Final business state remains in SQLite, `data/cache/`, `data/import-runs/`, and `data/product-checks/`.

Running task snapshots are throttled to reduce local disk churn on large batches. `SKILL_EVAL_TASK_FLUSH_MS` controls the flush interval and defaults to `250`; final success or failure states are always flushed immediately.

## Review Workbench State

The review page keeps operator state in the URL so a reviewer can reload, share a local deep link, or return to the same work position:

```text
/?batch=<batchId>&item=<itemId>&model=<model>&status=<status>&q=<search>&lang=<en|zh>&archived=1
```

Supported `status` values are `all`, `active`, `unreviewed`, `reviewed`, and `excluded`. Invalid URL values fall back to safe defaults. The URL contains only local ids and filter state; it does not include prompt text, image URLs, comments, or scores.

The left item queue uses fixed-height virtual rows for large batches. Only the visible window plus overscan rows are rendered, while the selected item still remains recoverable through the URL and the Current button. This keeps review scrolling responsive without changing the SQLite or API contract.

## Review Filters And Shortcuts

The review queue supports compound filters in the main toolbar and the Filters drawer:

- Score range.
- Required and excluded issue tags.
- Reviewer id/name.
- Product Check product-preservation delta.
- Cache state: both cached, any failed, any missing, source failed, or result failed.
- Status filters including reviewed, needs recheck, failed, unreviewed, active, and excluded.

Filter state is stored in the URL using local ids, enums, tags, and numbers only. It does not put prompt text, image URLs, comments, or scores into shared links.

Keyboard shortcuts:

| Shortcut | Action |
| --- | --- |
| `J` / `K` | Next / previous visible item |
| `Shift+J` / `Shift+K` | Next / previous unreviewed item |
| `G` | Scroll the left queue back to the current item |
| `1`-`5` | Set the active score dimension |
| `Tab` / `Shift+Tab` | Move active score dimension |
| `S` or `Ctrl+Enter` | Save current review |
| `R` / `N` / `F` | Set status to reviewed / needs recheck / failed |
| `E` | Focus the exclude control for the current active item |
| `Shift+E` | Restore the current excluded item |
| `?` | Open shortcut help |
| `Esc` | Close shortcut help or the filter drawer |

Global shortcuts are disabled while an input, select, textarea, or contenteditable field is focused.

## Test Isolation

Runtime data lives under `data/` by default. Tests can redirect all SQLite and generated artifacts to an isolated root:

```powershell
$env:SKILL_EVAL_DATA_DIR = ".tmp/playwright-data"
$env:SKILL_EVAL_TEST = "1"
$env:SKILL_EVAL_LOG_LEVEL = "warn"
pnpm run smoke
pnpm run smoke:fixture
pnpm run test:e2e
pnpm run test:residue
pnpm run test:cleanup
```

`SKILL_EVAL_DATA_DIR` controls:

```text
<dataDir>/app.sqlite
<dataDir>/cache/
<dataDir>/import-runs/
<dataDir>/product-checks/
<dataDir>/task-runs/
```

`SKILL_EVAL_RESOURCE_DIR` can point resource imports at an alternate local directory. `pnpm run smoke:fixture` uses this with `tests/fixtures/sanitized-resource.json` so fixture validation never reads real `resource/` data. The fixture command allocates a free port and checks `/api/health` for the expected test run id, data root, and resource root before running API smoke checks; this prevents a stale or user-started dev server from being mistaken for the fixture server. The fixture also writes deterministic review scores and annotations before generating a sanitized report, so schema drift, score aggregation drift, tag-count drift, and sensitive-field leakage are caught automatically.

The review UI still uses stable virtual paths such as `/data/cache/<batchId>/<itemId>/source.png`. The server maps those virtual paths to the active data root, so tests can be isolated without changing frontend URLs or SQLite cache-path semantics.

Playwright starts the dev server with `SKILL_EVAL_DATA_DIR=.tmp/playwright-data`, `SKILL_EVAL_TEST=1`, and `SKILL_EVAL_LOG_LEVEL=warn`. This keeps browser tests away from real `data/app.sqlite` and suppresses per-item JSONL progress while preserving warning and failure logs.

`pnpm run test:residue` inspects the active data root for test-prefixed batches, audit entries, and artifacts. Run it against real `data/` before committing if you want to verify that browser/smoke tests did not touch local production-like review data.

## Local Audit Log

Local mutation events are recorded in SQLite in `audit_events`. This is for operator traceability, debugging, and test assertions, not for remote telemetry. The schema definition and comments live in `src/db.js`, keeping SQLite as the single source of truth.

Current audited events include:

```text
import.start
import.finish
import.fail
batch.archive
batch.restore
batch.delete_plan
batch.delete
item.exclude
item.restore
browser_cache.finish
product_check.start
product_check.finish
product_check.fail
evaluation.save
```

Saving a review writes one append-only row to `annotations`, updates `evaluations` as the latest snapshot for the item, and records an `evaluation.save` audit event.

Reviewer identity is attribution, not authentication. `SKILL_EVAL_REVIEWER=id:name` is an optional server-level override and locks the UI to that reviewer when present. Without that override, each browser stores its reviewer id/display name in localStorage and sends it with review, exclude, archive/delete, import, Product Check, and browser-cache mutations through local request headers. This supports multiple reviewers opening the same LAN server from different browsers or machines while keeping the first version local-first and permission-free.

The audit payload is intentionally sanitized. It stores ids, counts, statuses, byte counts, reasons, note lengths, and error summaries. It does not store prompt text, source URLs, result URLs, optimization prompts, reviewer comments, or uploaded JSON content.

Audit events are available locally:

```text
GET /api/audit-events?batchId=<batchId>&limit=100
GET /api/audit-events?itemId=<itemId>&limit=100
```

`audit_events` is not cascaded on batch deletion, so a local deletion can still be traced. Delete events record the delete plan counts before the batch row is removed.

## Batch Import

One JSON file is one batch. There are two input sources with the same JSON data contract:

- `resource/*.json`: choose one file and click Import Resource. The API only accepts a JSON basename from `resource/`, not a directory, subpath, or absolute path.
- Local upload: choose one `.json` file from the browser and click Import Upload. The browser sends the file content to the local server for one-time ingestion. The uploaded JSON is not copied into `resource/`.

The review UI runs a preflight before enabling import. Preflight uses the same parser and normalizer as the real import, but it does not write SQLite, does not create a batch, does not cache images, and does not write `data/import-runs/`. It reports valid/invalid rows, model counts, duplicate records, and a `sha256:` source digest. The final import sends that digest back to the server; if the source changed after preflight, the import fails with a digest mismatch instead of importing stale assumptions.

Each imported batch records source provenance in SQLite: `source_sha256` is the raw JSON digest, `source_size_bytes` is the raw byte size, `content_sha256` is the normalized semantic item digest, and `import_schema_version` records the importer contract. The review UI shows short digests in the top bar and warns during preflight when an existing batch already has the same source digest.

Each imported batch records the source file in SQLite as `batches.source_file`. `batches.source_dir` is `resource` for project-local resource imports and `upload` for browser-selected uploads. The import also writes a local summary:

```text
data/import-runs/<batchId>.json
```

The import summary includes counts, cache success/failure totals, and parse errors. It intentionally does not include prompt text, source URLs, result URLs, or optimization prompts.

During import, `pnpm run import:resource` emits JSONL progress to the terminal and waits for completion. In the review UI, Import Resource starts a background local-server task and the page polls task progress until the batch is ready. The events include the selected resource filename, batch id, item id, model, processed count, insert/duplicate counts, and source/result cache status. They do not print prompt text or remote URLs.

Import cache concurrency is intentionally bounded. Source/result images for inserted items are cached through a local worker queue, and each item is updated once after both image attempts finish. Use `--cache-workers=1` when debugging a proxy, remote host throttling, or a single problematic image.

## Product Consistency Check

Product Check is a local, reference-based QA pass for the product-preservation dimension. It is designed for source images where the product is on a pure or near-white background and the generated result should keep that same product fixed. It does not replace human review and does not write to the `evaluations` table.

Every new run records algorithm/profile metadata in `results.json` and `run-status.json`:

```text
algorithmVersion
thresholdProfileId
thresholdProfileDigest
```

Threshold profile definitions live in `scripts/product_check_profiles.json`; Python loads them through `scripts/product_check_profiles.py`. Older Product Check files that do not contain this metadata are still readable and are shown as legacy results.

Install the Python dependencies once:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

The pnpm scripts use `scripts/run-python.js`, which prefers the project `.venv` Python when it exists and falls back to the system Python.

From the review UI, click Run Product Check to start a background run for the currently selected batch. The page polls:

```text
data/product-checks/<batchId>/run-status.json
```

and reads final results from:

```text
data/product-checks/<batchId>/results.json
```

Product Check emits JSONL progress to the terminal and mirrors child-process output to:

```text
data/product-checks/<batchId>/run.log
```

Progress events include selected item counts, item ids, models, status, suggested score, unsupported reason, and final summary. They do not include prompt text or remote URLs.

Common runs:

```bash
pnpm run product-check:selftest
pnpm run product-check -- --model gemini --batch latest
pnpm run product-check -- --model gemini --batch latest --visualize
pnpm run product-check -- --item <item-id>
pnpm run product-check -- --all
pnpm run product-check -- --batch latest --include-excluded
pnpm run product-check -- --list-threshold-profiles
pnpm run product-check -- --batch latest --threshold-profile stable-2026-05-18
```

Useful options:

| Option | Meaning |
| --- | --- |
| `--batch latest` | Analyze the latest imported batch. This is the default batch mode. |
| `--model gemini` | Filter items by a case-insensitive model-name substring. |
| `--item <itemId>` | Analyze one item. Can be repeated. |
| `--all` | Analyze all batches. |
| `--limit <n>` | Limit selected rows after filtering. Useful for quick checks. |
| `--visualize` | Write mask, material, hole, match-box, and diff heatmap overlays. |
| `--output-dir <path>` | Override the default local output root. |
| `--workers <n>` | Run item checks concurrently. Use `1` for serial execution. |
| `--include-excluded` | Include soft-excluded items. By default Product Check skips them. |
| `--threshold-profile <id>` | Record a specific threshold profile id and digest for the run. |
| `--list-threshold-profiles` | Print known Product Check threshold profiles and exit. |

The review server passes `PRODUCT_CHECK_WORKERS` to Product Check and defaults to `4`. CLI runs default to `min(4, os.cpu_count())`. Results are written in the original item order even when worker completion order differs.

Default outputs:

```text
data/product-checks/<batchId>/results.json
data/product-checks/<batchId>/run-status.json
data/product-checks/<batchId>/run.log
data/product-checks/<batchId>/overlays/<itemId>-source-mask.png
data/product-checks/<batchId>/overlays/<itemId>-material-mask.png
data/product-checks/<batchId>/overlays/<itemId>-hole-mask.png
data/product-checks/<batchId>/overlays/<itemId>-result-match.png
data/product-checks/<batchId>/overlays/<itemId>-diff-heatmap.png
```

For `--item <itemId>`, the default output path is `data/product-checks/<itemId>/results.json`. For `--all`, it is `data/product-checks/all-batches/results.json`.

The result JSON includes item id, batch id, model, local cache paths, mask quality, bbox, layered metrics, `scoreVersion`, `scoreReasons`, `damageSignals`, suggested product-preservation score, confidence, issue tags, and overlay paths. It intentionally does not include prompt text, source URLs, result URLs, or optimization prompts.

Current algorithm boundary:

- Requires source and result images to have the same dimensions; otherwise returns `unsupported_size_mismatch`.
- Segments the source product into `materialMask`, `filledSilhouetteMask`, `holeMask`, and `contourBandMask`.
- Treats a white image border as a segmentation prior, not a hard whole-image rule. Products may touch one or more image edges, and small non-perfect-white background variation is allowed.
- Extracts the exterior background as only the near-white area connected to the image border. Internal white areas are not automatically treated as background.
- Classifies internal white connected components before scoring: white labels, white product bodies, highlights, and printed white material stay in `materialMask`; high-confidence openings such as rings or bag-handle holes move to `holeMask`.
- Uses a conservative material fallback: uncertain internal white areas stay in `materialMask` so product labels and white material are still checked for changes.
- Excludes `holeMask` from the primary material comparison. Hole background changes and possible hole filling are diagnostic only, so they do not cap the suggested score by themselves.
- Computes layered metrics such as `materialMeanDiff`, `materialP90Diff`, `materialSsim`, `materialNcc`, `contourEdgeDiff`, `holeMeanDiff`, `holeClosureScore`, `holeBoundaryDiff`, and `holeNonWhiteResultRatio`.
- Keeps legacy metric aliases such as `meanAbsDiff`, `p90AbsDiff`, `edgeBandDiff`, `ssim`, and `ncc` for frontend compatibility.
- Converts related metrics into `damageSignals` for `alignment`, `material`, `geometry`, and `hole`; each signal has a `none`, `mild`, `moderate`, or `severe` severity.
- Uses hard gates for protected-product movement, severe material mismatch, and severe product damage. Clear protected-product movement is a score 1 failure.
- Maps the worst confirmed damage severity to the score instead of stacking correlated penalties from `SSIM`, `NCC`, and contour metrics.
- Does not let `contourEdgeDiff` / `edgeBandDiff` alone force a 2 score. Contour changes are supporting evidence unless material or match signals confirm product damage.
- Keeps a guardrail that checked items without hard product-damage tags do not drop below 3, and low material diff with a strong match does not drop below 4.
- Emits advisory tags such as `product_changed`, `product_moved`, `silhouette_damage`, `foreground_overlap`, and `artifact`. `hole_filled` is intentionally not emitted in v3.2 because hole contents are excluded from product-material scoring.
- Returns `suggestedScore: null` for unsupported cases instead of guessing.

Useful v3.2 mask diagnostics include `exteriorBackgroundAreaRatio`, `borderStrictWhiteRatio`, `borderRelaxedWhiteRatio`, `internalWhiteAreaRatio`, `internalWhiteComponentCount`, `whiteMaterialAreaRatio`, `whiteMaterialComponentCount`, `holeAreaRatio`, `holeComponentCount`, and `holeConfidence`.

Product-preservation score semantics:

| Score | Meaning |
| --- | --- |
| 5 | Product is materially stable; scene/background-only changes are acceptable. |
| 4 | Mild product-adjacent evidence such as edge, shadow, or small structural drift, without confirmed product damage. |
| 3 | Moderate material or geometry evidence that needs reviewer attention, but no hard failure. |
| 2 | Confirmed severe product damage. |
| 1 | Protected product moved, or the material match is too poor to treat as the same product. |

## Local Access

There are two local runtime modes:

| Mode | Command | URL | Data root | Purpose |
| --- | --- | --- | --- | --- |
| Shared review service | `pnpm run service:start` | `http://127.0.0.1:4173` | `data/` | Real reviewers use this service on this machine. |
| Test environment | `pnpm run test-env:start` | `http://127.0.0.1:4174` | `.tmp/test-env-data/` | Developers validate changes without touching real reviews. |

Start or inspect the shared review service:

```powershell
pnpm run service:start
pnpm run service:status
```

The shared service binds to `127.0.0.1:4173` by default and writes logs to:

```text
data/logs/server.log
data/logs/server.err.log
```

Each shared-service start rotates non-empty current logs into:

```text
data/logs/archive/
```

Only the newest 10 `server-*.log` files and newest 10 `server-*.err.log` files are retained. The running service identity is stored in:

```text
data/service.pid.json
```

To prepare the test environment from local real-sample resource data:

```powershell
pnpm run test-env:reset
```

This rebuilds `.tmp/test-env-data/` by importing:

```text
resource/gemini_tasks_20260516-20260517.json
resource/Gemini_tasks_20260518-20260519.json
```

The default reset skips image downloads so normal development is fast and does not depend on remote image URLs. Use the full reset only when the change touches image caching or visual inspection:

```powershell
pnpm run test-env:reset:full
```

Then start the test server:

```powershell
pnpm run test-env:start
```

The standard development validation flow is:

```powershell
pnpm run check
pnpm run selftest
pnpm run test-env:smoke
```

`pnpm run test-env:smoke` runs the writable smoke checks only against `127.0.0.1:4174`. Do not run the writable `pnpm run smoke` against the shared service because it creates and deletes temporary test data.

After validation passes, restart the shared service once and run the read-only health check:

```powershell
pnpm run service:restart
pnpm run smoke:readonly
```

`pnpm run smoke:readonly` performs only `GET` requests (`/api/health`, `/`, `/api/batches`, and the first available batch's items/stats), so it is safe for the real `data/` service.

For one-off local development without the service scripts, start the server and open:

```text
http://127.0.0.1:4173
```

By default the dev server binds to `127.0.0.1`, so it is only reachable on the same machine. To allow another device on the same LAN to open it through this machine's IP address, bind to all interfaces or use `pnpm run service:start`:

```powershell
$env:HOST = "0.0.0.0"
pnpm run dev
```

For the background shared service, LAN exposure is explicit:

```powershell
pnpm run service:start -- -BindHost 0.0.0.0
```

Then open `http://<this-machine-ip>:4173` from the other device. If that still cannot connect, allow Node.js or TCP port `4173` through Windows Firewall for the current network profile.

To use a different port:

```powershell
$env:PORT = "4174"
pnpm run dev
```

## Review Rubric

This project evaluates product image-to-image generation, where the input product should stay fixed and the model should generate or improve the surrounding scene. The rubric therefore prioritizes source-image preservation and instruction-following over generic aesthetics.

The rubric is informed by common evaluation practice in image generation and image editing research:

- Text-image faithfulness should be judged as fine-grained prompt adherence, not only general image appeal.
- Image editing must evaluate whether the edit follows the instruction while preserving the parts of the source image that should remain unchanged.
- Human preference and commercial usefulness matter, but they should not override hard failures such as changing the product.
- For product background generation, integration details such as contact shadows, lighting, occlusion, and perspective are part of edit quality.

Useful references:

- TIFA: https://huggingface.co/papers/2303.11897
- ImageReward: https://huggingface.co/papers/2304.05977
- InstructPix2Pix: https://huggingface.co/papers/2211.09800
- MagicBrush: https://huggingface.co/papers/2306.10012

Scores use a 1-5 scale. The overall score is weighted:

```text
overall_score =
  product_preservation_score * 0.25 +
  instruction_adherence_score * 0.20 +
  integration_grounding_score * 0.15 +
  prompt_optimization_value_score * 0.15 +
  commercial_quality_score * 0.15 +
  technical_safety_score * 0.10
```

Dimensions:

- Product preservation, 25%: product pixels, silhouette, pose, size, position, identity, and material stay unchanged.
- Instruction adherence, 20%: result follows the original prompt and optimized prompt without adding forbidden elements.
- Scene integration, 15%: background, contact shadows, occlusion, lighting, and perspective ground the fixed product naturally.
- Prompt optimization value, 15%: optimized prompt improves controllability and clarity without over-constraining or drifting from intent.
- Commercial quality, 15%: image is clean, premium, attractive, and usable for ecommerce or marketing review.
- Technical and safety, 10%: no severe artifacts, broken geometry, unsafe content, brand-risk elements, or unreadable generated text.

Hard gates:

- If product preservation is 1-2, overall score is capped at 2.5.
- If instruction adherence is 1-2, overall score is capped at 3.0.
- If technical and safety is 1, overall score is capped at 2.0.

Built-in issue tags:

- `product_changed`
- `product_moved`
- `silhouette_damage`
- `foreground_overlap`
- `missing_contact_shadow`
- `lighting_mismatch`
- `perspective_mismatch`
- `prompt_drift`
- `over_constrained_prompt`
- `under_specified_prompt`
- `low_commercial_value`
- `artifact`
- `unsafe_or_brand_risk`
- `excellent`

## Local Artifact Rules

These files must stay local and must not be pushed to the remote repository:

- Input JSON and resource images under `resource/`.
- SQLite database, WAL/SHM files, and cached images under `data/`.
- Product-check outputs under `data/product-checks/`.
- Import run summaries under `data/import-runs/`.
- Browser test artifacts under `test-results/`, `playwright-report/`, and `blob-report/`.
- Isolated test data under `.tmp/` or `data-test/`.
- Future exported JSON, reports, screenshots, or review outputs.
- Python virtual environments and cache files such as `.venv/`, `__pycache__/`, and `*.pyc`.

The `.gitignore` is configured for this. Before committing, verify:

```bash
git status --short --ignored
```

Expected result: source/config files are visible as untracked or modified, while `data/` and `resource/` are ignored.

## Example Validation Record

Use this section as a validation template rather than a current production-data baseline. Keep real resource file names, batch ids, item ids, model distributions, cache counts, score distributions, and output paths out of committed docs unless they are from a deliberately sanitized fixture.

For a local batch, record validation in this shape:

- Imported one JSON file from `resource/<resource-file>.json`.
- Confirmed source/result image cache counts in the UI or smoke output.
- Ran Product Check for `<batch-id>` or `latest`, and inspected unsupported counts plus overlay outputs under `data/product-checks/<batch-id>/`.
- Confirmed generated reports and cache artifacts stayed under ignored local directories.

Recommended validation commands:

```bash
pnpm run check
pnpm run selftest
pnpm run review-utils:selftest
pnpm run product-check:selftest
pnpm run smoke
pnpm run smoke:fixture
pnpm run test:e2e
pnpm run test:visual
pnpm run test:residue
```
