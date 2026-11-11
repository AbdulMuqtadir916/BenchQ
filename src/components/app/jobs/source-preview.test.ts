import { createElement, type ComponentProps } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { FirmProvider } from "@/lib/tenancy/firm-context";
import { queryKeys } from "@/lib/query/keys";
import { firms } from "@/mocks/team";
import { stubJob } from "@/mocks/fixture-backend";
import { SourcePreview } from "./source-preview";

const FIRM = firms.find((firm) => firm.id === "firm_hts")!;
const listItem = { ...stubJob("firm_hts", "cand_01", 1, "Lead Java Developer"), description: "" }; // a list item has none

function render(client: QueryClient): string {
  return renderToString(createElement(QueryClientProvider, { client },
    createElement(FirmProvider, { firm: FIRM } as ComponentProps<typeof FirmProvider>,
      createElement(SourcePreview, { job: listItem, portal: "FREEHIRE" }))));
}

describe("the source preview (docs/02 §6.z): the description comes from the one job's read", () => {
  it("shows the whole description the single read brings, though the list item has none", () => {
    const client = new QueryClient();
    client.setQueryData(queryKeys.jobs.detail("firm_hts", listItem.id), { ...listItem, description: "Build services in Java.\nRequirements:\n- Spring Boot\n- AWS" });
    const html = render(client);
    expect(html).toContain("Build services in Java.");
    expect(html).toContain("Spring Boot");
    expect(html).toContain("AWS");
  });

  it("says it is loading until the read answers", () => {
    const html = render(new QueryClient());
    expect(html).toContain("Loading the job description");
  });
});
