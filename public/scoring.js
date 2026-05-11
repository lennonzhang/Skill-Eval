export const scoreFields = [
  {
    field: "product_preservation_score",
    label: "Product preservation",
    shortLabel: "P",
    weight: 0.25,
    weightLabel: "25%",
    help: "Subject pixels, pose, size, position, identity, and silhouette remain unchanged.",
  },
  {
    field: "instruction_adherence_score",
    label: "Instruction adherence",
    shortLabel: "I",
    weight: 0.2,
    weightLabel: "20%",
    help: "Result follows the original prompt and optimized prompt without adding forbidden elements.",
  },
  {
    field: "integration_grounding_score",
    label: "Scene integration",
    shortLabel: "G",
    weight: 0.15,
    weightLabel: "15%",
    help: "Background, contact shadows, occlusion, lighting, and perspective make the fixed product feel grounded.",
  },
  {
    field: "prompt_optimization_value_score",
    label: "Optimization value",
    shortLabel: "O",
    weight: 0.15,
    weightLabel: "15%",
    help: "Optimized prompt adds useful constraints and clarity without over-constraining or drifting from intent.",
  },
  {
    field: "commercial_quality_score",
    label: "Commercial quality",
    shortLabel: "C",
    weight: 0.15,
    weightLabel: "15%",
    help: "Image is attractive, premium, clean, and usable for ecommerce or marketing review.",
  },
  {
    field: "technical_safety_score",
    label: "Technical and safety",
    shortLabel: "T",
    weight: 0.1,
    weightLabel: "10%",
    help: "No severe artifacts, broken geometry, unsafe content, brand-risk elements, or unreadable generated text.",
  },
];

export const scoreFieldNames = scoreFields.map((field) => field.field);

export const tagOptions = [
  "product_changed",
  "product_moved",
  "silhouette_damage",
  "foreground_overlap",
  "missing_contact_shadow",
  "lighting_mismatch",
  "perspective_mismatch",
  "prompt_drift",
  "over_constrained_prompt",
  "under_specified_prompt",
  "low_commercial_value",
  "artifact",
  "unsafe_or_brand_risk",
  "excellent",
];

export const statusOptions = ["reviewed", "needs_recheck", "failed"];

export class EvaluationValidationError extends Error {
  constructor(issues) {
    super("Invalid evaluation input");
    this.name = "EvaluationValidationError";
    this.issues = issues;
  }
}

function isScore(value) {
  return Number.isInteger(value) && value >= 1 && value <= 5;
}

export function calculateOverallScore(evaluation) {
  const weighted = scoreFields.reduce((total, { field, weight }) => total + evaluation[field] * weight, 0);

  let gated = weighted;
  if (evaluation.product_preservation_score <= 2) gated = Math.min(gated, 2.5);
  if (evaluation.instruction_adherence_score <= 2) gated = Math.min(gated, 3);
  if (evaluation.technical_safety_score <= 1) gated = Math.min(gated, 2);
  return Number(gated.toFixed(2));
}

export function validateEvaluationInput(input) {
  const issues = [];
  const normalized = {};

  for (const field of scoreFieldNames) {
    if (!(field in Object(input ?? {}))) {
      issues.push(`${field} is required`);
      continue;
    }
    const score = Number(input[field]);
    if (!isScore(score)) {
      issues.push(`${field} must be an integer from 1 to 5`);
      continue;
    }
    normalized[field] = score;
  }

  const status = String(input?.status ?? "");
  if (!statusOptions.includes(status)) {
    issues.push(`status must be one of: ${statusOptions.join(", ")}`);
  } else {
    normalized.status = status;
  }

  if (!Array.isArray(input?.tags)) {
    issues.push("tags must be an array");
  } else {
    const invalidTags = input.tags.filter((tag) => !tagOptions.includes(tag));
    if (invalidTags.length) {
      issues.push(`tags contain unsupported value(s): ${invalidTags.join(", ")}`);
    }
    normalized.tags = [...new Set(input.tags)];
  }

  const comment = String(input?.comment ?? "");
  if (comment.length > 4000) {
    issues.push("comment must be 4000 characters or fewer");
  } else {
    normalized.comment = comment;
  }

  if (issues.length) {
    throw new EvaluationValidationError(issues);
  }

  return normalized;
}

