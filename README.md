# Skill Eval

Skill Eval is a local-first review tool for evaluating image-generation results after an agent uses a skill to optimize prompts. The first version focuses on one practical workflow: import a batch, cache images locally, review items manually, and inspect batch-level model statistics.

## Current Features

- Import task result JSON files from `resource/`.
- Extract model, original prompt, source image URL, optimized prompt, and result image URL.
- Cache remote images under the local project folder at `data/cache/`.
- Store batches, items, and evaluations in SQLite at `data/app.sqlite`.
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
pnpm run import:resource
pnpm run dev
pnpm run check
pnpm run clear:evaluations
pnpm run selftest
pnpm run smoke
```

Command details:

- `pnpm run import:resource`: import `resource/*.json` and cache images.
- `pnpm run dev`: start the local review server.
- `pnpm run check`: syntax-check server, scripts, database/importer code, and frontend JS.
- `pnpm run clear:evaluations`: delete all local evaluation records.
- `pnpm run selftest`: validate scoring persistence and statistics inside a rollback transaction.
- `pnpm run smoke`: run read-only checks against a running local server.

Do not run `pnpm import`. That is a pnpm built-in command, not this project's data-import script.

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
- Future exported JSON, reports, screenshots, or review outputs.

The `.gitignore` is configured for this. Before committing, verify:

```bash
git status --short --ignored
```

Expected result: source/config files are visible as untracked or modified, while `data/` and `resource/` are ignored.

## Verified Baseline

The current resource import was tested with:

- 2 JSON files.
- 20 total items.
- 10 `gemini-3.1-flash-image-preview` items.
- 10 `seedream-5-0-260128` items.
- 20/20 source images cached.
- 19/20 result images cached.

One result image failed to download from the remote URL. The review page shows the failure state and keeps the original URL available, so review can continue.

Validation passed:

```bash
pnpm run check
pnpm run selftest
pnpm run smoke
```
