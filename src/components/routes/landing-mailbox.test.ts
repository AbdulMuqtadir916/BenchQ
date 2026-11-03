import { describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import RootPage from "@/app/page";

vi.mock("next/navigation", () => ({useRouter: () => ({replace: vi.fn()})}));
vi.mock("@/lib/hooks/use-session", () => ({useCurrentSession: () => ({data:null, isError:false})}));
vi.mock("@/lib/stores/session-store", () => ({
  useIsSessionSettling: () => false,
  useSession: (selector: (state: {principal:null}) => unknown) => selector({principal:null}),
}));

describe("OAuth fallback landing", () => {
  it("renders the failure explanation and deliberate continue action at the actual fallback destination", async () => {
    const root = await RootPage({searchParams:Promise.resolve({mailbox:"failed"})});
    const html = renderToString(root);
    expect(html).toContain('role="alert"');
    expect(html).toContain("Google connection was not completed");
    expect(html).toContain("Continue to BenchQ");
  });
  it.each([undefined, "connected", ["failed"]])("does not invent a failure for an absent/invalid result: %s", async mailbox => {
    const root = await RootPage({searchParams:Promise.resolve({mailbox})});
    expect(renderToString(root)).not.toContain("Google connection was not completed");
  });
});
