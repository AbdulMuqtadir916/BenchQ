import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import applications from "@/mocks/data/applications.json";
import { ApplicationSchema, type Application } from "@/lib/schemas/application";
import { ApplicationCardFace } from "./application-card";

const base: Application = ApplicationSchema.parse(applications[0]);
const html = (app: Application, showReviewBadge?: boolean) =>
  renderToStaticMarkup(<ApplicationCardFace app={app} owner="Sneha Rao" showReviewBadge={showReviewBadge} />);

describe("the BDE review badge on an application card", () => {
  it("shows while an email review is pending", () => {
    expect(html({ ...base, pendingReviewCount: 1 })).toContain("BDE review");
  });

  it("is absent with no pending review", () => {
    expect(html({ ...base, pendingReviewCount: 0 })).not.toContain("BDE review");
  });

  it("is hidden inside the BDE review column", () => {
    expect(html({ ...base, pendingReviewCount: 2 }, false)).not.toContain("BDE review");
  });
});
