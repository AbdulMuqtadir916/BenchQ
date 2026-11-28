import { expect, it, vi } from "vitest";
import { answerPanelWindow } from "./panel-window";
import { fakeChrome } from "./test/fake-chrome";

async function panel(tab?: { id: number }) {
  const fake = fakeChrome();
  fake.tabs.getCurrent.mockResolvedValue(tab);
  vi.stubGlobal("chrome", fake);
  answerPanelWindow();
  await new Promise(resolve => setTimeout(resolve, 0));
  return (windowId: number) => {
    const respond = vi.fn();
    fake.runtime.onMessage.fire({ type: "panel-window", windowId }, { id: "extension-id" }, respond);
    return respond;
  };
}

it("answers for its own window only, so a panel elsewhere can't hide this window's launcher", async () => {
  const ask = await panel();
  expect(ask(1)).toHaveBeenCalledWith(true);
  expect(ask(2)).not.toHaveBeenCalled();
});

it("answers a question that arrives while it is still finding its window", async () => {
  const fake = fakeChrome();
  vi.stubGlobal("chrome", fake);
  answerPanelWindow();
  const respond = vi.fn();
  fake.runtime.onMessage.fire({ type: "panel-window", windowId: 1 }, { id: "extension-id" }, respond);
  await vi.waitFor(() => expect(respond).toHaveBeenCalledWith(true));
});

it("doesn't answer as the panel when index.html is open in a tab", async () => {
  expect((await panel({ id: 9 }))(1)).not.toHaveBeenCalled();
});
