import Link from "next/link";
import { ShieldX } from "lucide-react";
import { EmptyState } from "@/components/app/empty-state";
import { Button } from "@/components/ui/button";
import { hrefFor } from "@/lib/routes/registry";
import { GateScreen } from "./gate-screen";

/**
 * What `forbidden()` renders (src/app/forbidden.tsx), with a real 403. It is thrown from the layout, so it
 * has no shell and no firm context; "/" lands the person in their own workspace. The in-shell version is
 * ForbiddenState, which the route guard still shows on a client-side navigation.
 */
export function ForbiddenScreen() {
  return (
    <GateScreen>
      <EmptyState
        icon={ShieldX}
        variant="filtered"
        title="You don't have access to this page"
        description="This page isn't available to your role. If you need it, ask your firm's owner."
        action={
          <Button asChild variant="secondary">
            <Link href={hrefFor("root")}>Go to my workspace</Link>
          </Button>
        }
      />
    </GateScreen>
  );
}
