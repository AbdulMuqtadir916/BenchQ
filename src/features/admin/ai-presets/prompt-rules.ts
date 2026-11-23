import type { AiPromptSpec } from "@/lib/schemas/ai-presets";

/** The save check's wording for one prompt (08 Q18). The backend refuses the same. */
export function promptProblem(spec: AiPromptSpec, value: string): string | null {
  if (!value.trim()) return spec.optional ? null : "This prompt can't be empty.";
  const missing = spec.placeholders.filter((placeholder) => !value.includes(placeholder));
  return missing.length ? `Needs ${missing.join(", ")}.` : null;
}
