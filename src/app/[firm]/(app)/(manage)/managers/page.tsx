"use client";

import { Suspense } from "react";
import { ManagersList } from "@/features/managers/managers-list";

/** /managers — the owner's managers and their teams (docs/07 Q60). useSearchParams needs a Suspense boundary. */
export default function ManagersPage() {
  return (
    <Suspense>
      <ManagersList />
    </Suspense>
  );
}
