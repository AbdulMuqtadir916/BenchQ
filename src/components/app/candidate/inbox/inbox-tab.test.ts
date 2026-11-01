import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { InboxTab } from "@/components/app/candidate/inbox/inbox-tab";
import type { CandidateWorkspace } from "@/components/app/candidate/use-candidate-workspace";
import type { CandidateActions } from "@/components/app/candidate/candidate-actions";
import { InboxMessageSchema } from "@/lib/schemas/inbox";

vi.mock("@/lib/hooks/use-inbox", () => {
  const mutation = () => ({ mutate: vi.fn(), isPending: false, error: null });
  return { useDisconnectMailbox: mutation, useMarkRead: mutation, useSyncMailbox: mutation, useConnectMailbox: mutation };
});

describe("live classifier category filters", () => {
  it.each([
    ["SCREENING_CALL", "Calls"],
    ["MOVE_ON", "Not selected"],
  ] as const)("counts a %s email under %s", (signal, label) => {
    const message = InboxMessageSchema.parse({
      id: "synthetic-message", firmId: "synthetic-firm", candidateId: "synthetic-candidate", applicationId: null,
      subject: "Synthetic review email", fromName: "Synthetic Recruiter", fromEmail: "recruiter@example.test",
      snippet: "Synthetic", body: "Synthetic", receivedAt: "2026-10-31T12:00:00.000Z", isRead: true,
      signal, impliedStatus: signal, scheduledFor: null, classificationState: "DONE", classificationOutcome: "UNMATCHED",
      classificationConfidence: 0.9,
    });
    const ws = {
      candidate: { id: "synthetic-candidate", fullName: "Synthetic Candidate" },
      messages: [message], applications: [], suggestions: [],
      inbox: { connection: { status: "CONNECTED", address: "candidate@example.test", lastSyncedAt: null } },
      inboxQuery: { error: null, isLoading: false, refetch: vi.fn() },
    } as unknown as CandidateWorkspace;
    const actions = {} as CandidateActions;
    const html = renderToStaticMarkup(createElement(InboxTab, { ws, actions, canAct: false,
      selectedId: message.id, onSelect: vi.fn() }));
    const count = html.match(new RegExp(`${label}<span[^>]*>(\\d+)</span>`))?.[1];
    expect(count).toBe("1");
  });
});
