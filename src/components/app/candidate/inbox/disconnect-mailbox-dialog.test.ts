import { createElement, type ComponentProps } from "react";
import { renderToString } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { FirmProvider } from "@/lib/tenancy/firm-context";
import { firms } from "@/mocks/team";
import { DisconnectMailboxDialog } from "./disconnect-mailbox-dialog";

const firm = firms.find((item) => item.id === "firm_hts")!;

describe("disconnecting Gmail asks first", () => {
  it("names the candidate and says what stays", () => {
    const html = renderToString(createElement(QueryClientProvider, { client: new QueryClient() },
      createElement(FirmProvider, { firm } as ComponentProps<typeof FirmProvider>,
        createElement(DisconnectMailboxDialog, { candidateId: "cand_10", candidateName: "Ananya Reddy", onClose: () => {} })),
    )).replaceAll("<!-- -->", "");
    expect(html).toContain("Disconnect Gmail for Ananya Reddy?");
    expect(html).not.toContain("revokes its read-only access");
    expect(html).toContain("Emails already saved stay in BenchQ");
    expect(html).toContain(">Disconnect<");
  });
});
