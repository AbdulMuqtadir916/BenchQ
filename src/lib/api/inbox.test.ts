import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const message = { id: "mail-1", firm_id: "firm-a", candidate_id: "candidate-a", application_id: null,
  from_name: "Recruiter", from_email: "recruiter@example.test", subject: "Synthetic reply", snippet: "Hello",
  body: "Synthetic body", received_at: "2026-11-02T00:00:00+00:00", is_read: false, source_address: "old@example.test" };
const connection = { firm_id: "firm-a", candidate_id: "candidate-a", provider: "GOOGLE", address: "candidate@example.test",
  connected_at: "2026-11-02T00:00:00+00:00", last_synced_at: null, status: "CONNECTED", last_sync_error: null };
const inbox = { firm_id: "firm-a", candidate_id: "candidate-a", connection, messages: [message] };
const fetchMock = vi.fn();
beforeEach(() => { vi.resetModules(); vi.stubEnv("NEXT_PUBLIC_LIVE_MODULES", "inbox"); vi.stubGlobal("fetch", fetchMock); fetchMock.mockReset(); });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
const reply = (value: unknown, status = 200) => fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(value), {status, headers:{"content-type":"application/json"}}));

describe("candidate Gmail adapter", () => {
  it("reads scoped imports as unclassified and preserves source account and pre-sync state", async () => {
    reply(inbox);
    const { inboxApi } = await import("./inbox");
    const result = await inboxApi.byCandidate("firm-a", "candidate-a");
    expect(fetchMock.mock.calls[0][0]).toBe("/api/firms/firm-a/candidates/candidate-a/inbox");
    expect(fetchMock.mock.calls[0][1]).toMatchObject({credentials:"include"});
    expect(result.connection).toMatchObject({lastSyncedAt:null,status:"CONNECTED"});
    expect(result.messages[0]).toMatchObject({signal:null,impliedStatus:null,sourceAddress:"old@example.test",body:"Synthetic body"});
  });
  it("starts real Google consent with a local return path", async () => {
    reply({authorization_url:"https://accounts.google.com/o/oauth2/v2/auth?state=synthetic"});
    const { inboxApi } = await import("./inbox");
    expect(await inboxApi.connect("firm-a", "candidate-a", "/acme/candidates/candidate-a?tab=inbox")).toContain("https://accounts.google.com/");
    expect(fetchMock.mock.calls[0][1]).toMatchObject({method:"POST",body:JSON.stringify({return_to:"/acme/candidates/candidate-a?tab=inbox"})});
  });
  it.each(["javascript:alert(1)","https://attacker.test/oauth","http://accounts.google.com/o/oauth2/v2/auth"])("rejects an unsafe authorization URL: %s", async (url) => {
    reply({authorization_url:url});
    const { inboxApi } = await import("./inbox");
    await expect(inboxApi.connect("firm-a", "candidate-a", "/")).rejects.toMatchObject({code:"SCHEMA_MISMATCH"});
  });
  it("sync performs a POST and maps the imported inbox", async () => {
    reply({imported:1,inbox});
    const { inboxApi } = await import("./inbox");
    expect((await inboxApi.sync("firm-a","candidate-a")).messages).toHaveLength(1);
    expect(fetchMock.mock.calls[0][0]).toContain("/mailbox/sync");
    expect(fetchMock.mock.calls[0][1].method).toBe("POST");
  });
  it("disconnect preserves retained email and the disconnected status", async () => {
    reply({...inbox,connection:{...connection,status:"DISCONNECTED"}});
    const { inboxApi } = await import("./inbox");
    const result = await inboxApi.disconnect("firm-a","candidate-a");
    expect(result.connection?.status).toBe("DISCONNECTED");
    expect(result.messages[0].sourceAddress).toBe("old@example.test");
    expect(fetchMock.mock.calls[0][1].method).toBe("DELETE");
  });
  it("read marking includes firm and candidate and surfaces failures", async () => {
    reply({detail:"Synthetic provider failure"},503);
    const { inboxApi } = await import("./inbox");
    await expect(inboxApi.markRead("firm-a","candidate-a","mail-1")).rejects.toMatchObject({status:503});
    expect(fetchMock.mock.calls[0][0]).toBe("/api/firms/firm-a/candidates/candidate-a/inbox-messages/mail-1/read");
    expect(fetchMock.mock.calls[0][1].method).toBe("PATCH");
  });
});
