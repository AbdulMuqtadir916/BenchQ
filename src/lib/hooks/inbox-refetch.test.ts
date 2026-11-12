import { describe, expect, it } from "vitest";
import type { InfiniteData } from "@tanstack/react-query";
import { CandidateInboxSchema, type CandidateInbox } from "@/lib/schemas/inbox";
import { CLASSIFY_POLL_MS, IDLE_POLL_MS, IMPORT_POLL_MS, classificationSnapshot, classificationsFinished, inboxRefetchInterval } from "./use-inbox";

const message = (id: string, classificationState?: string) => ({ id, firmId: "firm", candidateId: "candidate", applicationId: null,
  fromName: "Recruiter", fromEmail: "r@example.test", subject: id, snippet: "", body: "", receivedAt: "2026-11-02T00:00:00Z",
  signal: null, impliedStatus: null, scheduledFor: null, isRead: true, classificationState });
const connection = (status: string, syncState: string) => ({ firmId: "firm", candidateId: "candidate", provider: "GOOGLE", address: "a@example.test",
  connectedAt: "2026-11-02T00:00:00Z", lastSyncedAt: null, status, lastSyncError: null, syncState });
const pages = (messages: ReturnType<typeof message>[], conn: unknown = null): InfiniteData<CandidateInbox, string | null> => ({
  pages: [CandidateInboxSchema.parse({ firmId: "firm", connection: conn, messages, nextCursor: null })], pageParams: [null],
});

describe("inbox refresh rate", () => {
  it("polls quickly while any email is waiting or being classified, so the label updates by itself", () => {
    expect(inboxRefetchInterval(pages([message("a", "DONE"), message("b", "PENDING")]))).toBe(CLASSIFY_POLL_MS);
    expect(inboxRefetchInterval(pages([message("a", "PROCESSING")]))).toBe(CLASSIFY_POLL_MS);
  });

  it("stops polling quickly once every email is classified", () => {
    expect(inboxRefetchInterval(pages([message("a", "DONE"), message("b", "ERROR"), message("c", "NOT_QUEUED")]))).toBe(false);
  });

  it("keeps the slow refresh for a connected mailbox with nothing to wait for", () => {
    const connected = connection("CONNECTED", "IDLE");
    expect(inboxRefetchInterval(pages([message("a", "DONE")], connected))).toBe(IDLE_POLL_MS);
  });

  it("polls fastest while the mailbox is importing", () => {
    const importing = connection("CONNECTED", "IMPORTING");
    expect(inboxRefetchInterval(pages([message("a", "PENDING")], importing))).toBe(IMPORT_POLL_MS);
  });

  it("does nothing before the first load", () => {
    expect(inboxRefetchInterval(undefined)).toBe(false);
  });
});

describe("a finished classification reloads the reviews and applications", () => {
  const snapshot = (...messages: Array<ReturnType<typeof message> & { receivedAt?: string; classificationVersion?: number }>) =>
    classificationSnapshot(CandidateInboxSchema.parse({ firmId: "firm", connection: null, messages, nextCursor: null }).messages);

  it("sees an email finish while another starts, with the same number waiting", () => {
    expect(classificationsFinished(snapshot(message("a", "PENDING")), snapshot(message("b", "PENDING"), message("a", "DONE")))).toBe(true);
  });

  it("sees newer mail that arrived already classified, and a new result for the same email", () => {
    const before = snapshot({ ...message("a", "DONE"), classificationVersion: 1 });
    expect(classificationsFinished(before, snapshot({ ...message("n", "DONE"), receivedAt: "2026-11-03T00:00:00Z" }, { ...message("a", "DONE"), classificationVersion: 1 }))).toBe(true);
    expect(classificationsFinished(before, snapshot({ ...message("a", "DONE"), classificationVersion: 2 }))).toBe(true);
  });

  it("ignores older mail shown by Load more and an inbox that did not change", () => {
    const before = snapshot(message("a", "DONE"));
    expect(classificationsFinished(before, snapshot(message("a", "DONE"), { ...message("old", "DONE"), receivedAt: "2026-11-01T00:00:00Z" }))).toBe(false);
    expect(classificationsFinished(before, snapshot(message("a", "DONE")))).toBe(false);
  });
});
