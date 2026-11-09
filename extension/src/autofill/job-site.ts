import { indexBankByType } from "../engine/bank";
import { REFERRAL } from "./answer-keys";
import { hostOf } from "./job-check";
import type { BankEntry, JobSummary } from "./types";

/** Where BenchQ found a job, as the answer to "How did you hear about us?": the board in the job's `source`
 * (`jobspy_linkedin`, `linkedin_extension`, `jobspy_zip_recruiter`…; a company's own careers page is `direct`), else
 * the board its address is on. Null when neither says, as for a job saved by hand from an employer's or an applicant
 * tracking system's page: that doesn't tell how the job was found, so the saved answer, or the BDE, decides. */

const FROM_SOURCE: [RegExp, string][] = [
  [/linkedin/, "LinkedIn"], [/indeed/, "Indeed"], [/zip_?recruiter/, "ZipRecruiter"], [/glassdoor/, "Glassdoor"],
  [/(^|_)dice($|_)/, "Dice"], [/monster/, "Monster"], [/careerbuilder/, "CareerBuilder"], [/simplyhired/, "SimplyHired"],
  [/wellfound|(^|_)angel(list)?($|_)/, "Wellfound"], [/builtin/, "Built In"], [/naukri/, "Naukri"], [/jobright/, "Jobright"],
  [/levels_?fyi/, "Levels.fyi"], [/google/, "Google"],
];
const COMPANY_PAGE = /^(direct|playwright_)/;
/** Boards by their address. Google isn't here: careers.google.com is Google's own careers page. */
const FROM_HOST: [RegExp, string][] = [
  [/(^|\.)linkedin\.com$/, "LinkedIn"], [/(^|\.)indeed\.[a-z.]+$/, "Indeed"], [/(^|\.)ziprecruiter\.com$/, "ZipRecruiter"],
  [/(^|\.)glassdoor\.[a-z.]+$/, "Glassdoor"], [/(^|\.)dice\.com$/, "Dice"], [/(^|\.)monster\.[a-z.]+$/, "Monster"],
  [/(^|\.)careerbuilder\.com$/, "CareerBuilder"], [/(^|\.)simplyhired\.com$/, "SimplyHired"],
  [/(^|\.)(wellfound\.com|angel\.co)$/, "Wellfound"], [/(^|\.)builtin[a-z]*\.com$/, "Built In"], [/(^|\.)naukri\.com$/, "Naukri"],
  [/(^|\.)jobright\.ai$/, "Jobright"], [/(^|\.)levels\.fyi$/, "Levels.fyi"],
];

export function jobSite({ source, url }: Partial<Pick<JobSummary, "source" | "url">>): string | null {
  const from = (source ?? "").trim().toLowerCase();
  if (COMPANY_PAGE.test(from)) return "Company website";
  const board = FROM_SOURCE.find(([pattern]) => pattern.test(from));
  if (board) return board[1];
  const host = hostOf(url ?? "").toLowerCase();
  return host ? FROM_HOST.find(([pattern]) => pattern.test(host))?.[1] ?? null : null;
}

/** The bank with "How did you hear about us?" answered by where BenchQ found the job. When that's known it wins over
 * an answer the résumé saved for the question, so the two don't both turn up for the BDE to choose from; when it isn't,
 * the saved answer stays. */
export function withJobSite(bank: BankEntry[], job: Partial<Pick<JobSummary, "source" | "url">>): BankEntry[] {
  const site = jobSite(job);
  if (!site) return bank;
  const saved = new Set(indexBankByType(bank).get("referral-source") ?? []);
  const answer: BankEntry = { id: `key:${REFERRAL}`, question: "How did you hear about us?", answer: site, category: "OTHER", key: REFERRAL };
  return [...bank.filter((entry) => !saved.has(entry)), answer];
}
