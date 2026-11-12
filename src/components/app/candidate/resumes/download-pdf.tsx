"use client";

import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { resumeFileName } from "@/lib/derive/resume-name";
import { useOpenedResume } from "@/lib/hooks/use-resumes";
import { Button } from "@/components/ui/button";
import { usePrintExport } from "@/components/app/resume-studio/print-export";

/**
 * Download PDF straight from the list: loads the version, then prints it with the editor's own export (same sheets,
 * page breaks and links as the editor's Download), through the browser's "Save as PDF".
 */
export function DownloadPdfButton({ versionId, fileName, label }: { versionId: string; fileName: string; label: string }) {
  const [isRequested, setRequested] = useState(false);
  const opened = useOpenedResume(isRequested ? versionId : "");
  const exporter = usePrintExport(opened.data?.document ?? null, resumeFileName(fileName), false);
  const isLoading = isRequested && opened.isFetching;
  const isFailed = isRequested && opened.isError && !opened.isFetching;
  return (
    <>
      <Button variant="secondary" size="sm" aria-label={label} disabled={isLoading} onClick={() => { setRequested(true); if (opened.isError) void opened.refetch(); exporter.print(); }}>
        {isLoading ? <Loader2 size={13} className="animate-spin" aria-hidden /> : <Download size={13} aria-hidden />}
        {isLoading ? "Preparing…" : isFailed ? "Couldn't load. Try again" : "Download PDF"}
      </Button>
      {exporter.portal}
    </>
  );
}
