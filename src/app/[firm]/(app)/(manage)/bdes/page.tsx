"use client";

import { Suspense } from "react";
import { BdesList } from "@/features/bdes/bdes-list";

/** /bdes — a manager's team of BDEs and their numbers. useSearchParams needs a Suspense boundary. */
export default function BdesPage() {
  return (
    <Suspense>
      <BdesList />
    </Suspense>
  );
}
