"use client";

import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import type { ResumeDocument } from "@/lib/schemas/resume-document";
import { resumeFileName } from "@/lib/derive/resume-name";
import { useLoadOpenedResume } from "@/lib/hooks/use-resumes";
import { Button } from "@/components/ui/button";
import { usePrintExport } from "@/components/app/resume-studio/print-export";

/**
 * Download PDF straight from the list: loads the version, then prints it with the editor's own export (same sheets,
 * page breaks and links as the editor's Download), through the browser's "Save as PDF". The print is armed only once
 * the version has loaded, so a failed load leaves nothing waiting to print later; the next click tries again.
 */
export function DownloadPdfButton({ versionId, fileName, label }: { versionId: string; fileName: string; label: string }) {
  const load = useLoadOpenedResume();
  const [doc, setDoc] = useState<ResumeDocument | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "failed">("idle");
  const exporter = usePrintExport(doc, resumeFileName(fileName), false);

  async function download() {
    setState("loading");
    try {
      const opened = await load(versionId);
      setDoc(opened.document);
      setState("idle");
      exporter.print();
    } catch {
      setState("failed");
    }
  }

  return (
    <>
      <Button variant="secondary" size="sm" aria-label={label} disabled={state === "loading"} onClick={() => void download()}>
        {state === "loading" ? <Loader2 size={13} className="animate-spin" aria-hidden /> : <Download size={13} aria-hidden />}
        {state === "loading" ? "Preparing…" : state === "failed" ? "Couldn't load. Try again" : "Download PDF"}
      </Button>
      {exporter.portal}
    </>
  );
}
