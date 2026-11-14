import { mockResult, wait } from "./_shared";
import { requireAction } from "./membership";
import { RewriteInputSchema, type RewriteInput, type RewriteResult, RewriteResultSchema } from "@/lib/schemas/resume-document";

const STRONG_VERBS: Array<[RegExp, string]> = [
  [/^worked on\b/i, "Delivered"],
  [/^helped( to)?\b/i, "Drove"],
  [/^responsible for\b/i, "Owned"],
  [/^was part of\b/i, "Contributed to"],
  [/^made\b/i, "Built"],
  [/^did\b/i, "Executed"],
  [/^developed and maintained\b/i, "Engineered and scaled"],
  [/^implemented\b/i, "Designed and shipped"],
  [/^reduced\b/i, "Cut"],
  [/^improved\b/i, "Strengthened"],
  [/^led\b/i, "Directed"],
];

const FILLER: Array<[RegExp, string]> = [
  [/\bin order to\b/gi, "to"],
  [/\ba number of\b/gi, "several"],
  [/\bsuccessfully\s+/gi, ""],
  [/\bvarious\s+/gi, ""],
  [/\b(very|really|basically|actually)\s+/gi, ""],
  [/\butilized\b/gi, "used"],
  [/\bin the process of\s+/gi, ""],
];

const upperFirst = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);
const tidy = (value: string) => value.replace(/\s{2,}/g, " ").replace(/\s+([,.;])/g, "$1").trim();

function improve(text: string): string {
  for (const [pattern, verb] of STRONG_VERBS) {
    if (pattern.test(text)) return tidy(text.replace(pattern, verb));
  }
  return tidy(`${upperFirst(text.replace(/\.$/, ""))}, partnering with product and QA to ship on schedule`);
}

function concise(text: string): string {
  let output = FILLER.reduce((value, [pattern, replacement]) => value.replace(pattern, replacement), text);
  if (output.length > 90 && output.includes(", ")) output = output.slice(0, output.indexOf(", "));
  return upperFirst(tidy(output));
}

function quantify(text: string): string {
  const base = text.replace(/\.$/, "");
  return tidy(/\d/.test(base) ? `${base} across 3 product teams` : `${base}, cutting turnaround time by 30%`);
}

function grammar(text: string): string {
  return upperFirst(tidy(text.replace(/\bi\b/g, "I").replace(/\s+,/g, ",").replace(/,(?=\S)/g, ", ")));
}

const notes: Record<RewriteInput["action"], string> = {
  improve: "AI rewrite — confirm the wording still matches what the candidate did.",
  concise: "AI shortened this — confirm nothing important was dropped.",
  quantify: "AI added a metric — confirm the number with the candidate before it ships.",
  grammar: "AI corrected grammar — review before it ships.",
};

function rewriteText(input: RewriteInput): RewriteResult {
  const text = input.text.trim();
  const output = { improve, concise, quantify, grammar }[input.action](text);
  return RewriteResultSchema.parse({ text: output === text ? improve(text) : output, note: notes[input.action] });
}

export const agentsMock = {
  rewrite: async (rawInput: RewriteInput, signal?: AbortSignal): Promise<RewriteResult> => {
    // Not about one firm's records, but it is still editing a resume: read-only principals are refused.
    requireAction("resume.edit");
    const input = RewriteInputSchema.parse(rawInput);
    await wait(900, signal);
    return mockResult(rewriteText(input), signal);
  },
};
