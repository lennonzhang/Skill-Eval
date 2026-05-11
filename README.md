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
pnpm run selftest
pnpm run smoke
```

Command details:

- `pnpm run import:resource`: import `resource/*.json` and cache images.
- `pnpm run dev`: start the local review server.
- `pnpm run check`: syntax-check server, scripts, database/importer code, and frontend JS.
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

Scores use a 1-5 scale. The overall score is weighted:

```text
overall_score =
  intent_score * 0.25 +
  source_fidelity_score * 0.20 +
  prompt_optimization_score * 0.20 +
  visual_quality_score * 0.15 +
  technical_quality_score * 0.10 +
  safety_score * 0.10
```

Dimensions:

- Original intent alignment, 25%.
- Source image fidelity, 20%.
- Prompt optimization effectiveness, 20%.
- Visual quality, 15%.
- Technical quality, 10%.
- Safety and compliance, 10%.

Built-in issue tags:

- `off_prompt`
- `source_mismatch`
- `over_optimized`
- `under_specified`
- `artifact`
- `bad_text`
- `bad_anatomy`
- `style_mismatch`
- `unsafe`
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
