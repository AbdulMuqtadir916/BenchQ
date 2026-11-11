import { describe, expect, it } from "vitest";
import { CapturedPostingDto, FirmJobDto, JobSearchesDto, toBackendCapture, toCapturedJob, toFirmJob, toJobSearches } from "./jobs";

const posting = {
  id: "7b2f0c3e-0000-4000-8000-000000000001", source: "freehire", job_id: "a".repeat(64),
  discovered_at: "2026-11-11T13:05:00+00:00", last_seen_at: "2026-11-11T14:00:00+00:00",
  title: "Java Developer", company: "Example Corp", apply_url: "https://jobs.example.test/1", location: "Austin, TX",
  countries: ["us"], posted_at: "2026-11-10", employment_type: "Full-time", skills: ["Java", "Spring"], is_closed: false,
};

describe("a job from the backend (docs/02 §6.z): what a posting knows, nothing invented", () => {
  it("maps the known fields and leaves the rest unknown", () => {
    const job = toFirmJob(FirmJobDto.parse({ ...posting, candidate_ids: ["c1", "c2"] }), "firm_hts");
    expect(job).toMatchObject({
      id: posting.id, firmId: "firm_hts", title: "Java Developer", normalisedTitle: "java-developer", description: "",
      company: { name: "Example Corp", normalisedName: "example-corp", clientType: "UNKNOWN", domain: null, h1b: null, verification: null },
      city: "Austin, TX", state: null, country: "US", remoteMode: "ONSITE", employmentType: "FTE",
      rateMin: null, rateMax: null, salaryMin: null, salaryMax: null, applicantCount: null, excludesC2C: false,
      allowedWorkAuth: [], postedAt: "2026-11-10T00:00:00.000Z", applyUrl: "https://jobs.example.test/1", isActive: true,
      dedupe: { contentHash: posting.job_id, canonicalUrl: "https://jobs.example.test/1", duplicateOfJobId: null },
      provenance: { sourceType: "AGGREGATOR", sourceId: "freehire", legalBasis: "LICENSED_API", ingestedAt: "2026-11-11T13:05:00.000Z" },
      candidateIds: ["c1", "c2"],
    });
    expect(job.requirements.map((r) => [r.kind, r.category, r.value, r.isBlocker])).toEqual([["PREFERRED", "SKILL", "Java", false], ["PREFERRED", "SKILL", "Spring", false]]);
  });

  it("a remote location is remote; an unknown employment type, date or link stays unknown; a closed job is inactive", () => {
    const job = toFirmJob(FirmJobDto.parse({ ...posting, location: "Remote (US)", employment_type: "Contract", posted_at: "3 days ago",
      apply_url: "javascript:alert(1)", is_closed: true, candidate_ids: [] }), "firm_hts");
    expect(job).toMatchObject({ remoteMode: "REMOTE", employmentType: null, postedAt: null, applyUrl: null, isActive: false });
    expect(toFirmJob(FirmJobDto.parse({ ...posting, location: null, candidate_ids: [] }), "f").city).toBeNull();
    expect(toFirmJob(FirmJobDto.parse({ ...posting, location: "Austin, TX (Hybrid)", candidate_ids: [] }), "f").remoteMode).toBe("HYBRID");
  });

  it("a known H-1B sponsor is marked from the source; no mark is unknown, never \"doesn't sponsor\"", () => {
    expect(toFirmJob(FirmJobDto.parse({ ...posting, h1b_sponsor: true, candidate_ids: [] }), "f").company.h1b).toMatchObject({ sponsorsH1b: true, dataSource: "freehire.me" });
    expect(toFirmJob(FirmJobDto.parse({ ...posting, h1b_sponsor: false, candidate_ids: [] }), "f").company.h1b).toBeNull();
    expect(toFirmJob(FirmJobDto.parse({ ...posting, candidate_ids: [] }), "f").company.h1b).toBeNull();
  });

  it("a captured job is its candidate's, and says how it was added", () => {
    const job = toCapturedJob(CapturedPostingDto.parse({ ...posting, source: "manual", candidate_id: "c9", created: true, description: "Line one.\nLine two." }), "firm_hts");
    expect(job).toMatchObject({ candidateIds: ["c9"], description: "Line one.\nLine two.", provenance: { sourceType: "MANUAL", legalBasis: "USER_SESSION" } });
  });

  it("the capture form sends only what the backend keeps", () => {
    expect(toBackendCapture({ candidateId: "c9", sourceUrl: "https://jobs.example.test/1", title: "T", companyName: "C", location: "", description: "D" }))
      .toEqual({ source: "manual", title: "T", company: "C", description: "D", url: "https://jobs.example.test/1", location: null });
  });
});

describe("a candidate's searches", () => {
  it("maps the running search, the finished ones and today's usage", () => {
    const searches = toJobSearches(JobSearchesDto.parse({
      running: { batch_id: "b1", kind: "search", run_id: "r1", state: "running", error_code: null, query: "Java Developer", country: "us", provider: "freehire", counts: null, user_id: "u1", started_at: "2026-11-11T14:00:00+00:00", finished_at: null },
      searches: [
        { batch_id: "b0", kind: "search", state: "success", error_code: null, query: "Java Developer", counts: { found: 20, saved: 12, refreshed: 3, skipped_over_cap: 5 }, started_at: "2026-11-11T13:00:00+00:00", finished_at: "2026-11-11T13:00:09+00:00" },
        { batch_id: "bx", kind: "search", state: "error", error_code: "timeout", query: "QA", counts: null, started_at: "2026-11-11T12:00:00+00:00", finished_at: "2026-11-11T12:00:30+00:00" },
        { batch_id: "bc", kind: "capture", state: "success", error_code: null, query: null, counts: null, started_at: "2026-11-11T11:00:00+00:00", finished_at: "2026-11-11T11:00:00+00:00" },
      ],
      usage: { jobs_saved_today: 47, jobs_cap: 100, attempts_today: 3, attempts_cap: 20, captures_today: 2, captures_cap: 20, resets_at: "2026-11-12T13:00:00+00:00" },
    }));
    expect(searches.running).toMatchObject({ id: "b1", kind: "SEARCH", state: "RUNNING", newCount: 0, finishedAt: null });
    expect(searches.searches.map((s) => [s.kind, s.state, s.newCount, s.seenAgainCount, s.overLimitCount, s.errorCode])).toEqual([
      ["SEARCH", "SUCCESS", 12, 3, 5, null], ["SEARCH", "ERROR", 0, 0, 0, "timeout"], ["CAPTURE", "SUCCESS", 0, 0, 0, null],
    ]);
    expect(searches.usage).toEqual({ jobsToday: 47, jobsCap: 100, searchesToday: 3, searchesCap: 20, capturesToday: 2, capturesCap: 20, resetsAt: "2026-11-12T13:00:00.000Z" });
  });
});
