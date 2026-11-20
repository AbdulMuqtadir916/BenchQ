// @vitest-environment jsdom
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readJob } from "./job";

/** How much of what real job pages state the Add Job reading captures. Run on a corpus built by
 * `extension/scripts/build-job-corpus.py` (each page as served, with ground truth from its job board's own API, kept
 * only where the page shows it): `JOB_CORPUS=<dir> npx vitest run src/page/job-corpus`. Skipped otherwise. */
const DIR = process.env.JOB_CORPUS;
const norm = (value: unknown) => String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const near = (got: number | undefined, want: number) => got !== undefined && Math.abs(got - want) <= Math.max(1, want * 0.01);
const sameDay = (got: string | undefined, want: string) => Boolean(got) && Math.abs(Date.parse(got!) - Date.parse(want)) <= 86_400_000;

describe.skipIf(!DIR)("real job pages (JOB_CORPUS)", () => {
  it("captures the details the pages state", () => {
    const tally = new Map<string, [number, number]>();
    const misses: string[] = [];
    for (const file of readdirSync(DIR!).filter((name) => name.endsWith(".json")).sort()) {
      const { url, platform, truth } = JSON.parse(readFileSync(join(DIR!, file), "utf8")) as { url: string; platform: string; truth: Record<string, string & number> };
      const doc = new DOMParser().parseFromString(readFileSync(join(DIR!, file.replace(".json", ".html")), "utf8"), "text/html");
      const job = readJob(doc, url);
      const company = norm(job.company);
      const checks: Record<string, () => boolean> = {
        title: () => norm(job.title) === norm(truth.title),
        company: () => Boolean(company) && (company.includes(norm(truth.company)) || norm(truth.company).includes(company)),
        location: () => norm(job.location).includes(norm(String(truth.location).split(",")[0])),
        work_mode: () => job.workMode === truth.work_mode,
        employment_type: () => (job.employmentType ?? "").split(", ").includes(truth.employment_type),
        salary_min: () => near(job.salaryMin, truth.salary_min),
        salary_max: () => near(job.salaryMax, truth.salary_max),
        salary_currency: () => job.salaryCurrency === truth.salary_currency,
        salary_period: () => job.salaryPeriod === truth.salary_period,
        posted_at: () => sameDay(job.postedAt, truth.posted_at),
        requisition_id: () => norm(job.requisitionId) === norm(truth.requisition_id),
      };
      // Every page states its description; it counts when the reading holds more than a heading's worth of it.
      for (const [key, holds] of [...Object.keys(truth).map((key) => [key, checks[key]!()] as const), ["description", job.description.length >= 200] as const]) {
        const [hit, total] = tally.get(key) ?? [0, 0];
        tally.set(key, [hit + (holds ? 1 : 0), total + 1]);
        if (!holds) misses.push(`${file} ${platform} ${key}: want ${JSON.stringify(truth[key] ?? "text")} got ${JSON.stringify(key === "description" ? job.description.length : (job as Record<string, unknown>)[{ work_mode: "workMode", employment_type: "employmentType", salary_min: "salaryMin", salary_max: "salaryMax", salary_currency: "salaryCurrency", salary_period: "salaryPeriod", posted_at: "postedAt", requisition_id: "requisitionId" }[key] ?? key])}`);
      }
    }
    const [hit, total] = [...tally.values()].reduce(([a, b], [c, d]) => [a + c, b + d], [0, 0]);
    const report = [...tally].map(([key, [h, t]]) => `${key} ${h}/${t}`).join(" · ") + ` · overall ${hit}/${total} = ${(100 * hit / total).toFixed(1)}%`;
    writeFileSync(join(DIR!, "results.txt"), [report, ...misses].join("\n"));
    console.log(report);
    expect(total).toBeGreaterThan(0);
  }, 120_000);
});
