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
const render = (canAct: boolean) =>
  renderToString(
    createElement(QueryClientProvider, { client: new QueryClient() },
      createElement(FirmProvider, { firm } as ComponentProps<typeof FirmProvider>,
        createElement(ApplicationBoard, { apps, canAct, onMove: () => {}, candidateName: () => "x" }))),
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
