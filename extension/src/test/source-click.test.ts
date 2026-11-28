import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

// @vitest-environment jsdom
const source = readFileSync("public/source-click.js", "utf8");

function click(label: string, marked: boolean, isOpened = true) {
  const anchor = document.createElement("a");
  anchor.href = "https://jobs.example.org/jobs/42";
  anchor.target = "_blank";
  anchor.innerHTML = "<span></span>";
  anchor.firstElementChild!.textContent = label;
  if (marked) {
    anchor.dataset.benchqJob = "42";
    anchor.dataset.candidate = "7";
  }
  const listen = vi.fn();
  const sendMessage = vi.fn().mockResolvedValue(isOpened);
  const open = vi.fn();
  const context = { document: { addEventListener: listen }, window: { open }, Element, URLSearchParams, location: new URL("https://benchq.example/firm/jobs"), chrome: { runtime: { id: "test", sendMessage } } };
  runInNewContext(source, context);
  const event = { isTrusted: true, button: 0, target: anchor.firstElementChild, preventDefault: vi.fn() };
  listen.mock.calls[0]![1](event);
  return { sendMessage, event, open };
}

describe("Open source click bridge", () => {
  it.each(["Open source", "Open on LinkedIn", "Open original", "Open in new tab"])("opens the assistant for the deployed %s link", label => {
    expect(click(label, false).sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "source-click" }));
  });
  it("forwards the candidate and job from annotated links", () => {
    expect(click("Open source", true).sendMessage).toHaveBeenCalledWith(expect.objectContaining({ candidateId: "7", jobId: "42" }));
  });
  it("opens the link in a new tab itself, keeping BenchQ open, when the extension can't", async () => {
    const { open } = click("Open source", true, false);
    await vi.waitFor(() => expect(open).toHaveBeenCalledWith("https://jobs.example.org/jobs/42", "_blank", "noopener,noreferrer"));
  });
  it("leaves ordinary external links alone", () => {
    expect(click("Help center", false).event.preventDefault).not.toHaveBeenCalled();
  });
});
