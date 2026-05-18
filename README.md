# Skill Eval

Skill Eval is a local-first review tool for evaluating image-generation results after an agent uses a skill to optimize prompts. The first version focuses on one practical workflow: import a batch, cache images locally, review items manually, and inspect batch-level model statistics.

## Current Features

- Import task result JSON files from `resource/` or a browser-selected local JSON upload.
- Extract model, original prompt, source image URL, optimized prompt, and result image URL.
- Cache remote images under the local project folder at `data/cache/`.
- Store batches, items, and evaluations in SQLite at `data/app.sqlite`.
- Run a local Python product-consistency prototype against cached source/result images.
- Provide a local review UI with:
  - Batch selection.
  - Model and review-status filters.
  - Source/result image comparison.
  - Soft Exclude/Restore for items that should stay visible but leave active statistics.
  - Original and optimized prompt display.
  - Weighted score controls.
  - Issue tags and reviewer comments.
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
pnpm run dev
pnpm run check
pnpm run clear:evaluations -- --yes
pnpm run selftest
pnpm run smoke
pnpm run product-check:selftest
pnpm run product-check -- --model gemini --batch latest --visualize
```

Command details:

- `pnpm run import:resource -- --file=<name.json>`: import one JSON from `resource/` as one batch and cache images unless `--no-images` is passed.
- Review UI local upload: choose a local `.json` with the same format as `resource/*.json`, then click Import Upload. The uploaded JSON is parsed into one batch but is not copied into `resource/`.
- `pnpm run dev`: start the local review server.
- `pnpm run check`: syntax-check server, scripts, database/importer code, frontend JS, and Python product-check scripts.
- `pnpm run clear:evaluations -- --yes`: delete all local evaluation records. This is a local reset command and requires the explicit `--yes` guard.
- `pnpm run selftest`: validate scoring persistence and statistics inside a rollback transaction.
- `pnpm run smoke`: run read-only checks against a running local server.
- `pnpm run product-check:selftest`: run synthetic OpenCV/skimage regression tests without using production data.
- `pnpm run product-check -- ...`: run advisory product-preservation checks against cached images.

Do not run `pnpm import`. That is a pnpm built-in command, not this project's data-import script.

## Exclude / Restore

Use Exclude when a row should remain traceable but should not affect review progress, model averages, tag counts, cache progress, or default Product Check runs. This is a soft state on the item, not a delete. The review queue still shows excluded rows, greyed out and sorted after active rows, so they can be inspected and restored later.

Supported exclude reasons are:

```text
bad_input
duplicate
wrong_task
missing_image
not_evaluable
other
```

Storage stays in the SQLite source of truth in `src/db.js`: `items.excluded_at`, `items.exclude_reason`, and `items.exclude_note`. Existing evaluations are preserved when an item is excluded, but excluded items are omitted from active stats and `Next Unreviewed`. The Product Check CLI also omits excluded items by default; use `--include-excluded` only for explicit debugging.

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

## Batch Import

One JSON file is one batch. There are two input sources with the same JSON data contract:

- `resource/*.json`: choose one file and click Import Resource. The API only accepts a JSON basename from `resource/`, not a directory, subpath, or absolute path.
- Local upload: choose one `.json` file from the browser and click Import Upload. The browser sends the file content to the local server for one-time ingestion. The uploaded JSON is not copied into `resource/`.

Each imported batch records the source file in SQLite as `batches.source_file`. `batches.source_dir` is `resource` for project-local resource imports and `upload` for browser-selected uploads. The import also writes a local summary:

```text
data/import-runs/<batchId>.json
```

The import summary includes counts, cache success/failure totals, and parse errors. It intentionally does not include prompt text, source URLs, result URLs, or optimization prompts.

During import, `pnpm run import:resource` emits JSONL progress to the terminal and waits for completion. In the review UI, Import Resource starts a background local-server task and the page polls task progress until the batch is ready. The events include the selected resource filename, batch id, item id, model, processed count, insert/duplicate counts, and source/result cache status. They do not print prompt text or remote URLs.

Import cache concurrency is intentionally bounded. Source/result images for inserted items are cached through a local worker queue, and each item is updated once after both image attempts finish. Use `--cache-workers=1` when debugging a proxy, remote host throttling, or a single problematic image.

## Product Consistency Check

Product Check v3.2 is a local, reference-based QA pass for the product-preservation dimension. It is designed for source images where the product is on a pure or near-white background and the generated result should keep that same product fixed. It does not replace human review and does not write to the `evaluations` table.

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

After starting the server, open:

```text
http://127.0.0.1:4173
```

By default the dev server binds to `127.0.0.1`, so it is only reachable on the same machine. To allow another device on the same LAN to open it through this machine's IP address, bind to all interfaces:

```powershell
$env:HOST = "0.0.0.0"
pnpm run dev
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
pnpm run product-check:selftest
pnpm run product-check -- --model gemini --batch latest --visualize
pnpm run smoke
```
