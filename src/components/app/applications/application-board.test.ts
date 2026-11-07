import { createElement, type ComponentProps } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { FirmProvider } from "@/lib/tenancy/firm-context";
import { firms } from "@/mocks/team";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { allApplications } from "@/mocks/applications";
import { ApplicationBoard } from "./application-board";

/**
 * The board renders drag handles only for someone who can act: for a VIEWER (canAct false) every card
 * is a plain button that opens the application; nothing carries "draggable" semantics or "Space to move".
 */
const apps = allApplications.filter((app) => app.firmId === "firm_hts").slice(0, 30);
const firm = firms.find((item) => item.id === "firm_hts")!;
const render = (canAct: boolean, boardApps = apps) =>
  renderToString(
    createElement(QueryClientProvider, { client: new QueryClient() },
      createElement(FirmProvider, { firm } as ComponentProps<typeof FirmProvider>,
        createElement(ApplicationBoard, { apps: boardApps, canAct, onMove: () => {}, candidateName: () => "x" }))),
  );

describe("application board: who can drag", () => {
  it("renders nothing draggable when the viewer can't act (VIEWER)", () => {
    const html = render(false);
    expect(html).toContain("Application pipeline");
    expect(html).not.toContain('aria-roledescription="draggable"');
    expect(html).not.toContain("Space to move");
    expect(html).not.toContain("bq-board-card");
  });

  it("renders the drag handles for someone who can act", () => {
    const html = render(true);
    expect(html).toContain('aria-roledescription="draggable"');
    expect(html).toContain("Space to move");
  });
});


describe("application board: review and incomplete columns", () => {
  it("hides Incomplete when no application has that status", () => {
    const html = render(false, [{ ...apps[0], status: "APPLIED" }]);
    expect(html).not.toContain('aria-label="Incomplete application,');
    expect(html.indexOf('aria-label="Applied,')).toBeLessThan(html.indexOf('aria-label="BDE Review,'));
    expect(html.indexOf('aria-label="BDE Review,')).toBeLessThan(html.indexOf('aria-label="Screening call,'));
  });

  it("inserts populated Incomplete between Applied and BDE Review", () => {
    const app = { ...apps[0], status: "INCOMPLETE_APPLICATION" as const, pendingReviewCount: 1 };
    const html = render(true, [app]);
    expect(html.indexOf('aria-label="Applied,')).toBeLessThan(html.indexOf('aria-label="Incomplete application, 1"'));
    expect(html.indexOf('aria-label="Incomplete application, 1"')).toBeLessThan(html.indexOf('aria-label="BDE Review, 1"'));
    expect(html.replaceAll("<!-- -->", "")).toContain("Last confirmed: Incomplete application");
    expect(html).not.toContain('aria-roledescription="draggable"');
    expect(app.status).toBe("INCOMPLETE_APPLICATION");
  });
});
