"use client";

import { Suspense, use } from "react";
import { useSearchParams } from "next/navigation";
import { OpenResume } from "@/components/app/resume-studio/open-resume";
import { NewResume } from "@/components/app/resume-studio/new-resume";

/**
 * Full-screen resume workspace. Lives outside the (app) group so the sidebar
 * and top nav are not rendered — the resume gets the whole screen.
 * ?mode=view opens in Viewer mode; ?review=1 lands on the first unverified claim;
 * /resumes/new?upload=<file> starts from an upload.
 */
function ResumeStudioRoute({ id }: { id: string }) {
  const search = useSearchParams();
  const mode = search.get("mode") === "view" ? "view" : "build";
  if (id === "new") return <NewResume initialMode={mode} upload={search.get("upload")} />;
  return <OpenResume id={id} initialMode={mode} review={search.get("review") === "1"} />;
}

export default function ResumeStudioPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <Suspense>
      <ResumeStudioRoute id={id} />
    </Suspense>
  );
}
