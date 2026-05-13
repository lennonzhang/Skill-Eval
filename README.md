# Skill Eval

Skill Eval is a local-first review tool for evaluating image-generation results after an agent uses a skill to optimize prompts. The first version focuses on one practical workflow: import a batch, cache images locally, review items manually, and inspect batch-level model statistics.

## Current Features

- Import task result JSON files from `resource/`.
- Extract model, original prompt, source image URL, optimized prompt, and result image URL.
- Cache remote images under the local project folder at `data/cache/`.
- Store batches, items, and evaluations in SQLite at `data/app.sqlite`.
- Run a local Python product-consistency prototype against cached source/result images.
- Provide a local review UI with:
  - Batch selection.
  - Model and review-status filters.
  - Source/result image comparison.
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
- `pnpm run dev`: start the local review server.
- `pnpm run check`: syntax-check server, scripts, database/importer code, frontend JS, and Python product-check scripts.
- `pnpm run clear:evaluations -- --yes`: delete all local evaluation records. This is a local reset command and requires the explicit `--yes` guard.
- `pnpm run selftest`: validate scoring persistence and statistics inside a rollback transaction.
- `pnpm run smoke`: run read-only checks against a running local server.
- `pnpm run product-check:selftest`: run synthetic OpenCV/skimage regression tests without using production data.
- `pnpm run product-check -- ...`: run advisory product-preservation checks against cached images.

Do not run `pnpm import`. That is a pnpm built-in command, not this project's data-import script.

## Batch Import

One JSON file is one batch. The review UI lists `resource/*.json`; choose one file and click Import Resource. The API only accepts a JSON basename from `resource/`, not a directory, subpath, or absolute path.

Each imported batch records the source file in SQLite as `batches.source_file`. The import also writes a local summary:

```text
data/import-runs/<batchId>.json
```

The import summary includes counts, cache success/failure totals, and parse errors. It intentionally does not include prompt text, source URLs, result URLs, or optimization prompts.

## Product Consistency Check

The v0.3 prototype is a local, reference-based QA pass for the product-preservation dimension. It is designed for source images where the product is on a mostly white background and the generated result should keep that same product fixed. It does not replace human review and does not write to the `evaluations` table.

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

Common runs:

```bash
pnpm run product-check:selftest
pnpm run product-check -- --model gemini --batch latest
pnpm run product-check -- --model gemini --batch latest --visualize
pnpm run product-check -- --item <item-id>
pnpm run product-check -- --all
```

Useful options:

| Option | Meaning |
| --- | --- |
| `--batch latest` | Analyze the latest imported batch. This is the default batch mode. |
| `--model gemini` | Filter items by a case-insensitive model-name substring. |
| `--item <itemId>` | Analyze one item. Can be repeated. |
| `--all` | Analyze all batches. |
| `--limit <n>` | Limit selected rows after filtering. Useful for quick checks. |
| `--visualize` | Write mask, match-box, and diff heatmap overlays. |
| `--output-dir <path>` | Override the default local output root. |

Default outputs:

```text
data/product-checks/<batchId>/results.json
data/product-checks/<batchId>/run-status.json
data/product-checks/<batchId>/run.log
data/product-checks/<batchId>/overlays/<itemId>-source-mask.png
data/product-checks/<batchId>/overlays/<itemId>-result-match.png
data/product-checks/<batchId>/overlays/<itemId>-diff-heatmap.png
```

For `--item <itemId>`, the default output path is `data/product-checks/<itemId>/results.json`. For `--all`, it is `data/product-checks/all-batches/results.json`.

The result JSON includes item id, batch id, model, local cache paths, mask quality, bbox, metrics, suggested product-preservation score, confidence, issue tags, and overlay paths. It intentionally does not include prompt text, source URLs, result URLs, or optimization prompts.

Current algorithm boundary:

- Requires source and result images to have the same dimensions; otherwise returns `unsupported_size_mismatch`.
- Segments the source product from a mostly white background with white-distance, HSV saturation, Canny edges, border flood fill, morphology, hole filling, and connected-component cleanup.
- Computes masked image metrics: mean absolute difference, P90 difference, Lab delta, edge-band difference, SSIM, NCC, and local offset search around the source bbox.
- Emits advisory tags such as `product_changed`, `product_moved`, `silhouette_damage`, `foreground_overlap`, and `artifact`.
- Returns `suggestedScore: null` for unsupported cases instead of guessing.

## Local Access

After starting the server, open:

```text
http://127.0.0.1:4173
```

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
