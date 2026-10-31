import { afterEach, describe, expect, it, vi } from "vitest";
import sample from "./dto/__samples__/inbox.json";
import { inboxApi } from "./inbox";
import { http } from "./http";

vi.mock("./http", () => ({ http: { get: vi.fn(), post: vi.fn(), delete: vi.fn(), patch: vi.fn() } }));
afterEach(() => vi.resetAllMocks());

describe("live candidate Inbox adapter", () => {
  it("loads only the candidate-scoped backend inbox", async () => {
    vi.mocked(http.get).mockResolvedValue(sample);
    const inbox = await inboxApi.byCandidate("firm", "candidate");
    expect(http.get).toHaveBeenCalledWith("/api/firms/firm/candidates/candidate/inbox", expect.anything(), undefined);
    expect(inbox.messages[0]?.signal).toBeNull();
  });

  it("loads the exact linked email even when it is outside the latest Inbox page", async () => {
    vi.mocked(http.get).mockResolvedValue(sample);
    await inboxApi.byCandidate("firm", "candidate", "old-review-email");
    expect(http.get).toHaveBeenCalledWith("/api/firms/firm/candidates/candidate/inbox", expect.anything(),
      { query: { message_id: "old-review-email", limit: 1 } });
  });

  it("loads every page of the firm's scoped unmatched review queue through the DTO mapper", async () => {
    vi.mocked(http.get)
      .mockResolvedValueOnce({ total: 2, messages: [{ ...sample.messages[0], id: "email-1", body: "" }] })
      .mockResolvedValueOnce({ total: 2, messages: [{ ...sample.messages[0], id: "email-2", body: "" }] });
    const messages = await inboxApi.unmatchedReviews("firm");
    expect(messages.map((message) => message.id)).toEqual(["email-1", "email-2"]);
    expect(http.get).toHaveBeenNthCalledWith(2, "/api/firms/firm/inbox/unmatched-reviews", expect.anything(),
      { query: { limit: 200, offset: 1 } });
    expect(messages[0]?.candidateId).toBeDefined();
    expect(messages[0]?.body).toBe("");
  });

  it("starts Google OAuth with a local return path", async () => {
    vi.mocked(http.post).mockResolvedValue({ authorization_url: "https://accounts.google.test/oauth" });
    await expect(inboxApi.connect("firm", "candidate", "/adnan-staffing/candidates/candidate?tab=inbox"))
      .resolves.toBe("https://accounts.google.test/oauth");
    expect(http.post).toHaveBeenCalledWith("/api/firms/firm/candidates/candidate/mailbox/oauth", expect.anything(), {
      body: { return_to: "/adnan-staffing/candidates/candidate?tab=inbox" },
    });
  });

  it("returns an empty review queue without requesting further pages", async () => {
    vi.mocked(http.get).mockResolvedValue({ total: 0, messages: [] });
    await expect(inboxApi.unmatchedReviews("firm")).resolves.toEqual([]);
    expect(http.get).toHaveBeenCalledTimes(1);
  });

  it("does not present a partial review queue as complete when a later page fails", async () => {
    vi.mocked(http.get)
      .mockResolvedValueOnce({ total: 2, messages: [{ ...sample.messages[0], id: "email-1", body: "" }] })
      .mockRejectedValueOnce(new Error("Review queue unavailable"));
    await expect(inboxApi.unmatchedReviews("firm")).rejects.toThrow("Review queue unavailable");
  });

  it("stops paging if concurrent review resolution leaves a page empty", async () => {
    vi.mocked(http.get)
      .mockResolvedValueOnce({ total: 2, messages: [{ ...sample.messages[0], id: "email-1", body: "" }] })
      .mockResolvedValueOnce({ total: 1, messages: [] });
    const messages = await inboxApi.unmatchedReviews("firm");
    expect(messages.map((message) => message.id)).toEqual(["email-1"]);
    expect(http.get).toHaveBeenCalledTimes(2);
  });

  it("propagates backend errors without falling back to the Inbox mock", async () => {
    vi.mocked(http.get).mockRejectedValue(new Error("Inbox unavailable"));
    await expect(inboxApi.byCandidate("firm", "candidate")).rejects.toThrow("Inbox unavailable");
  });

  it("submits the BDE-selected status and concurrency revisions to the scoped review route", async () => {
    vi.mocked(http.patch).mockResolvedValue(sample);
    await inboxApi.reviewMessage("firm", "candidate", "email-1", {
      application_id: "application-1", status: "assessment", expected_revision: 3,
      review_id: "review-1", expected_review_revision: 1,
    });
    expect(http.patch).toHaveBeenCalledWith(
      "/api/firms/firm/candidates/candidate/inbox-messages/email-1/review",
      expect.anything(),
      { body: { application_id: "application-1", status: "assessment", expected_revision: 3,
        review_id: "review-1", expected_review_revision: 1 } },
    );
  });

  it("queues retry only through the candidate-scoped classification endpoint", async () => {
    vi.mocked(http.post).mockResolvedValue(sample);
    await inboxApi.retryClassification("firm", "candidate", "email-1");
    expect(http.post).toHaveBeenCalledWith(
      "/api/firms/firm/candidates/candidate/inbox-messages/email-1/classification/retry",
      expect.anything(),
    );
  });
});
