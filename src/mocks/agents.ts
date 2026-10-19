import { mockResult, wait } from "./_shared";
import { firmScoped, requireAction } from "./membership";
import { AgentDraftSchema, TailorResumeInputSchema, type AgentDraft, type TailorResumeInput } from "@/lib/schemas/agent";
import { RewriteInputSchema, type RewriteInput, type RewriteResult, RewriteResultSchema } from "@/lib/schemas/resume-document";
import { ResumeClaimSchema, type ResumeClaim } from "@/lib/schemas/resume";

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

const stages = [
  "Reading the candidate record",
  "Extracting job requirements",
  "Matching evidence",
  "Drafting tailored claims",
];

function draftClaims(resumeVersionId: string): ResumeClaim[] {
  return [
    ResumeClaimSchema.parse({
      id: `agent_${resumeVersionId}_summary`,
      resumeVersionId,
      section: "summary",
      entityId: null,
      bulletIndex: null,
      text: "Senior engineer focused on reliable delivery across cloud-native platforms.",
      state: "UNVERIFIED",
      evidenceId: null,
      reason: "AI-drafted summary requires evidence review.",
      overriddenByUserId: null,
      overrideReason: null,
      overriddenAt: null,
    }),
    ResumeClaimSchema.parse({
      id: `agent_${resumeVersionId}_experience`,
      resumeVersionId,
      section: "experience",
      entityId: null,
      bulletIndex: 0,
      text: "Improved deployment reliability by standardising automated release workflows.",
      state: "UNVERIFIED",
      evidenceId: null,
      reason: "The outcome is plausible but no supporting evidence is linked yet.",
      overriddenByUserId: null,
      overrideReason: null,
      overriddenAt: null,
    }),
  ];
}

export const agentsMock = {
  rewrite: async (rawInput: RewriteInput, signal?: AbortSignal): Promise<RewriteResult> => {
    // Not about one firm's records, but it is still editing a resume: read-only principals are refused.
    requireAction("resume.edit");
    const input = RewriteInputSchema.parse(rawInput);
    await wait(900, signal);
    return mockResult(rewriteText(input), signal);
  },

  // Firm-scoped: a tailoring run belongs to a firm (Q21). `rewrite` works on text alone.
  ...firmScoped("agents", {
    tailorResume: async (firmId: string, rawInput: TailorResumeInput, signal?: AbortSignal): Promise<AgentDraft> => {
      const input = TailorResumeInputSchema.parse(rawInput);
      await wait(2_000, signal);
      return mockResult(AgentDraftSchema.parse({
        runId: `run_${input.resumeVersionId}_${input.jobId}`,
        firmId,
        resumeVersionId: input.resumeVersionId,
        jobId: input.jobId,
        stages,
        claims: draftClaims(input.resumeVersionId),
        generatedAt: new Date().toISOString(),
      }), signal);
    },
  }, { tailorResume: "resume.edit" }),
};
