import { createElement, type ComponentProps } from "react";
import { renderToString } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// renderToString reads the session store's initial (signed-out) snapshot: the panel reads the live store instead.
vi.mock("@/lib/stores/session-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/stores/session-store")>();
  return { ...actual, useSignedInPrincipal: () => actual.useSession.getState().principal! };
});
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { FirmProvider } from "@/lib/tenancy/firm-context";
import { firms } from "@/mocks/team";
import { signInAs, signInAsSupportView, signOutForTest } from "@/mocks/sign-in-as";
import { useSession } from "@/lib/stores/session-store";
import { queryKeys } from "@/lib/query/keys";
import type { TailoringRun } from "@/lib/schemas/tailoring";
import { Row, TailoringPanel } from "./tailoring-panel";
import { startedOutcomes } from "./messages";

/** The BDE's panel (decided 2026-11-12, part 3 R2-Q1–Q3, R3-Q2), rendered from the runs its read returned. */
const FIRM = "firm_hts";
const now = Date.now();
const run = (over: Partial<TailoringRun>): TailoringRun => ({
  runId: "run", status: "running", step: null, resumeId: null, errorCode: null, candidateId: "cand_01", sourceResumeId: "v1",
  baseResumeId: "b1", jobId: "post-1", jobTitle: "A job", startedAt: new Date(now - 42_000).toISOString(), finishedAt: null, ...over,
});

function render(runs: TailoringRun[]): string {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(queryKeys.tailorings.mine(FIRM), runs);
  client.setQueryData(queryKeys.candidates.list(FIRM), []);
  return renderToString(createElement(QueryClientProvider, { client }, createElement(FirmProvider,
    { firm: firms.find((firm) => firm.id === FIRM)! } as ComponentProps<typeof FirmProvider>, createElement(TailoringPanel))));
}

describe("the tailoring panel", () => {
  beforeAll(async () => useSession.getState().setSession(await signInAs("user_adnan")));
  afterAll(() => { useSession.getState().reset(); signOutForTest(); });

  it("shows nothing when the BDE has no tailorings", () => {
    expect(render([])).toBe("");
  });

  it("shows the open run's real steps, and each other run with its state and action", () => {
    const html = render([
      run({ runId: "a", step: "review", jobTitle: "Java Developer" }),
      run({ runId: "b", step: "draft", jobTitle: "Backend Engineer" }),
      run({ runId: "c", status: "completed", resumeId: "r9", jobTitle: "Spring Developer", finishedAt: new Date(now).toISOString() }),
      run({ runId: "d", status: "failed", errorCode: "provider_failed", jobTitle: "Platform Engineer" }),
      run({ runId: "e", status: "failed", errorCode: "gone", jobTitle: "Gone Job" }),
    ]);
    expect(html).toContain("2 tailoring · 1 ready");
    expect(html).toContain("Java Developer");                 // the open one, as the staged panel
    expect(html).toContain("Reviewing the draft");
    expect(html).toContain("Writing the draft");              // the other running one's step
    expect(html).toContain("Tailored résumé ready.");
    expect(html).toContain("Open");
    expect(html).toContain("Tailoring failed.");
    expect(html.match(/Try again/g)?.length).toBe(1);        // only where it can help
    expect(html).toContain("The résumé or the job was removed.");
    expect(html).toContain("Hide tailorings");
    expect(html).toContain("Dismiss Spring Developer");
    expect(html).not.toContain("Dismiss Java Developer");    // a running one is never dismissed
  });

  it("is never shown in a support view", async () => {
    useSession.getState().setSession(await signInAsSupportView("padm_sana", FIRM));
    expect(render([run({ runId: "a" })])).toBe("");
    useSession.getState().setSession(await signInAs("user_adnan"));
  });
});


describe("Abdul's review (2026-11-12)", () => {
  it("a refused Try again shows the new reason on its row", () => {
    const html = renderToString(createElement(Row, {
      run: run({ runId: "d", status: "failed", errorCode: "provider_failed", jobTitle: "Platform Engineer" }), name: null, now,
      openHref: null, onOpenSteps: () => undefined, onRetry: () => undefined, isRetrying: false, onDismiss: () => undefined,
      retryRefusal: "You have 5 tailorings running. Wait for one to finish.",
    }));
    expect(html).toContain("Tailoring failed.");
    expect(html).toContain("Not started again: You have 5 tailorings running. Wait for one to finish.");
  });

  it("Focus mode's Tailored counts the started runs that saved a résumé, not the starts", () => {
    const runs = [run({ runId: "a", status: "completed" }), run({ runId: "b" }), run({ runId: "c", status: "failed" }), run({ runId: "z", status: "completed" })];
    expect(startedOutcomes(runs, ["a", "b", "c"])).toEqual({ tailored: 1, running: 1 });   // z: not this run's
  });
});
