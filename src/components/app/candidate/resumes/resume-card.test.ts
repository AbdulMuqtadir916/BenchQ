import { createElement, type ComponentProps } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import sample from "@/lib/api/dto/__samples__/resumes.json";
import { ResumeShelfDto, toResumeShelf } from "@/lib/api/dto/resumes";
import { buildResumeTree } from "@/lib/derive/resume-tree";
import { FirmProvider } from "@/lib/tenancy/firm-context";
import { firms } from "@/mocks/team";
import type { TreeLabels } from "@/components/app/resumes/base-folder";
import { ResumeCard } from "./resume-card";
import { resumeCards } from "./resume-cards";
import type { CardActions } from "./use-card-actions";

const shelf = toResumeShelf(ResumeShelfDto.parse(sample.listing), "firm_hts");
const cards = resumeCards(buildResumeTree(shelf)[0]!.bases, "Java Developer");
const labels: TreeLabels = { job: () => ({ company: "Acme", title: "Data Engineer" }), candidate: () => null, userName: () => "Ben" };
const noop = () => undefined;
const bde: CardActions = { canChange: true, canManage: true, makeMain: noop, saveAsNew: noop, deleteResume: noop, deleteVersion: noop, showAgain: noop };

function render(card: (typeof cards)[number], actions?: CardActions): string {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const firm = firms.find((f) => f.id === "firm_hts")!;
  return renderToString(createElement(QueryClientProvider, { client },
    createElement(FirmProvider, { firm } as ComponentProps<typeof FirmProvider>,
      createElement("ul", null, createElement(ResumeCard, { card, labels, candidateName: "Asha Rao", actions, onMakeJobCopy: noop })))));
}

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;|&#39;/g, "'").replace(/\s+/g, " ");
const JARGON = /\b(base|tailored|active|latest|uploaded)\b|\bv\d\b/i;

describe("a résumé card", () => {
  const [main, other] = cards;

  it("marks the main résumé, with View and Download PDF, and no 'Make main' on it", () => {
    const html = render(main!, bde);
    expect(text(html)).toContain("Main résumé");
    expect(text(html)).toContain("View");
    expect(text(html)).toContain("Download PDF");
    expect(text(html)).not.toContain("Make main résumé");
  });

  it("offers another résumé a labelled 'Make main résumé' and a ⋯ menu with a name", () => {
    const html = render(other!, bde);
    expect(text(html)).toContain("Make main résumé");
    expect(html).toMatch(/aria-label="More actions for [^"]+"/);
    expect(text(html)).not.toContain("Main résumé ");
  });

  it("shows older versions and job copies only as links, closed", () => {
    const html = render(other!, bde);
    expect(text(html)).toMatch(/See older versions \(\d\)/);
    expect(text(html)).toContain("Copies made for specific jobs (1)");
    expect(text(html)).not.toContain("Version 1");
  });

  it("gives a read-only person View and Download only", () => {
    const html = render(other!);
    expect(text(html)).not.toContain("Make main résumé");
    expect(html).not.toContain("More actions");
    expect(text(html)).toContain("Download PDF");
  });

  it("says nothing in internal terms", () => {
    for (const card of cards) expect(text(render(card, bde))).not.toMatch(JARGON);
  });
});
