// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://workforcenow.adp.com/"}
import { afterEach, expect, it, vi } from "vitest";
import { confirmsSmartApplication, smartApplication } from "../autofill/smart-application";
import { readJob, readJobForSave } from "./job";
import { setText } from "./events";
import { searchList, pickOption } from "./choice";

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

it("writes ADP identity fields through the focused browser editor", () => {
  const input = document.createElement("input");
  document.body.append(input);
  const insert = vi.fn((_command: string, _ui: boolean, value: string) => {
    expect(document.activeElement).toBe(input);
    input.value = value;
    return true;
  });
  Object.defineProperty(document, "execCommand", { value: insert, configurable: true });
  try {
    setText(input, "John");
    expect(insert).toHaveBeenCalledWith("insertText", false, "John");
    expect(input.value).toBe("John");
  } finally {
    Reflect.deleteProperty(document, "execCommand");
  }
});

it("ignores a cookie heading and a placeholder company on a posting", () => {
  document.body.innerHTML = '<main><h1>Set your cookie preferences</h1><h1>Programmer</h1><img alt="Company Logo"><button>Apply</button></main>';
  const job = readJob(document, "https://workforcenow.adp.com/jobs/12345");
  expect(job.title).toBe("Programmer");
  expect(job.company).not.toBe("Company");
});

it.each(["https://jobs.lever.co/tenant/12345678-1234-1234-1234-123456789012/apply", "https://apply.workable.com/tenant/j/ABC123/apply/"])("reads the owning listing for %s", async url => {
  const form = new DOMParser().parseFromString("<form></form>", "text/html");
  Object.defineProperty(form, "URL", { value: url });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, url: url.replace(/apply\/?$/, ""), text: async () =>
    '<script type="application/ld+json">{"@type":"JobPosting","title":"Programmer","description":"Build things","hiringOrganization":"Example"}</script>' }));
  expect(await readJobForSave(form)).toMatchObject({ title: "Programmer", url, isJobPage: true });
});

it("reads the listing behind an application page that shows only the role's heading", async () => {
  const url = "https://jobs.lever.co/tenant/12345678-1234-1234-1234-123456789012/apply";
  const form = new DOMParser().parseFromString("<main><h1>Programmer</h1><button>Apply</button></main>", "text/html");
  Object.defineProperty(form, "URL", { value: url });
  const fetched = vi.fn().mockResolvedValue({ ok: true, url: url.replace(/apply\/?$/, ""), text: async () =>
    '<script type="application/ld+json">{"@type":"JobPosting","title":"Programmer","description":"Build things","hiringOrganization":"Example"}</script>' });
  vi.stubGlobal("fetch", fetched);
  expect(await readJobForSave(form)).toMatchObject({ title: "Programmer", company: "Example", url });
  expect(fetched).toHaveBeenCalled();
});

it("discards a parent posting response when navigation happens while the response body loads", async () => {
  let url = "https://apply.workable.com/acme/j/PDT12407/apply/";
  const form = new DOMParser().parseFromString("<main></main>", "text/html");
  Object.defineProperty(form, "URL", { get: () => url });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, url: "https://apply.workable.com/acme/j/PDT12407/", text: async () => {
    url = "https://apply.workable.com/acme/jobs/search";
    return '<script type="application/ld+json">{"@type":"JobPosting","title":"Old role"}</script>';
  } }));
  expect(await readJobForSave(form)).toMatchObject({ isJobPage: false, url: "https://apply.workable.com/acme/jobs/search", title: "" });
});

it("keeps the application page's description when the listing behind it has none", async () => {
  const url = "https://jobs.lever.co/tenant/12345678-1234-1234-1234-123456789012/apply";
  const form = new DOMParser().parseFromString('<script type="application/ld+json">{"@type":"JobPosting","title":"Programmer","description":"Write code for the payments team.","hiringOrganization":"Example"}</script>', "text/html");
  Object.defineProperty(form, "URL", { value: url });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, url: url.replace(/apply\/?$/, ""), text: async () =>
    '<script type="application/ld+json">{"@type":"JobPosting","title":"Programmer"}</script>' }));
  expect(await readJobForSave(form)).toMatchObject({ title: "Programmer", description: expect.stringContaining("payments team"), url });
});

it("only confirms the publication named by the SmartRecruiters posting", async () => {
  const posting = "https://jobs.smartrecruiters.com/Example/12345-programmer";
  const uuid = "12345678-1234-1234-1234-123456789012";
  const form = smartApplication(posting, "https://jobs.smartrecruiters.com/oneclick-ui/company/Example/publication/" + uuid)!;
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, text: async () => `<script>window.ONECLICKDATA = {cident: 'Example', puuid: '${uuid}'};</script>` }));
  expect(await confirmsSmartApplication(posting, form, new AbortController().signal)).toBe(true);
  expect(await confirmsSmartApplication(posting, new URL(form.href.replace("9012", "9013")), new AbortController().signal)).toBe(false);
});

it("triggers Lever's keyboard lookup and commits the selected city", async () => {
  document.body.innerHTML = '<div data-qa="structured-contact-location-question"><div><input class="location-input"><div class="dropdown-results"></div></div></div>';
  const input = document.querySelector("input")!;
  input.onkeydown = () => {
    const option = document.createElement("div");
    option.className = "dropdown-location";
    option.textContent = "Dallas, Texas";
    option.onmousedown = () => { input.value = option.textContent!; };
    document.querySelector(".dropdown-results")!.append(option);
    vi.spyOn(option, "getClientRects").mockReturnValue([{}] as unknown as DOMRectList);
  };
  const [option] = await searchList(input, "Dallas");
  expect(option?.textContent).toBe("Dallas, Texas");
  pickOption(option!);
  expect(input.value).toBe("Dallas, Texas");
});
