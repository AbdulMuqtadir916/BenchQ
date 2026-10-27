"use client";

import { useRef, useState, type DragEvent } from "react";
import { CloudUpload, FileText, LoaderCircle, PencilLine, WandSparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SkeletonCard } from "@/components/app/skeleton-card";
import { RESUME_FILE, resumeFileProblem } from "@/lib/constants/candidate-intake";
import { useParseResume, useSampleResumes } from "@/lib/hooks/use-resume-parse";
import { cn } from "@/lib/cn";
import type { Wizard } from "./use-wizard";

/**
 * Step 1 (docs/candidate-onboarding/04-wizard-steps.md §3): a PDF or Word résumé, read by the backend's parser into a
 * draft that fills steps 2–4. Nothing is saved until the candidate is created (07 Q49). The file is checked here
 * first (type, 10 MB), so a wrong file never leaves the browser.
 */
export function StepResume({ wizard }: { wizard: Wizard }) {
  const parse = useParseResume();
  const samples = useSampleResumes();
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [lastFile, setLastFile] = useState<File | null>(null);

  function read(file: File) {
    const reason = resumeFileProblem(file);
    setProblem(reason);
    if (reason) return;
    setLastFile(file);
    parse.mutate(file, {
      onSuccess: (draft) => {
        wizard.applyResume(draft);
        wizard.goTo("basic");
      },
    });
  }

  function onDrop(event: DragEvent) {
    event.preventDefault();
    setIsDragging(false);
    const file = event.dataTransfer.files[0];
    if (file) read(file);
  }

  if (parse.isPending && lastFile) {
    return (
      <div className="space-y-4" aria-live="polite">
        <div className="flex items-center gap-3 rounded-[var(--radius-lg)] border border-[var(--color-border)] p-4">
          <LoaderCircle size={16} aria-hidden className="animate-spin text-[var(--color-primary)] motion-reduce:animate-none" />
          <div className="min-w-0">
            <p className="truncate text-body-strong text-[var(--color-text)]">{lastFile.name}</p>
            <p className="text-caption text-[var(--color-text-3)]">Reading the résumé…</p>
          </div>
        </div>
        <SkeletonCard />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={(event) => { event.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={onDrop}
        data-dragging={isDragging}
        aria-describedby="resume-drop-hint"
        className="bq-dropzone flex w-full flex-col items-center gap-2 px-6 py-12 text-center"
      >
        <span className="bq-card inline-flex h-11 w-11 items-center justify-center text-[var(--color-primary)]"><CloudUpload size={20} aria-hidden /></span>
        <span className="text-body-strong text-[var(--color-text)]">Drag a resume here, or click to browse</span>
        <span id="resume-drop-hint" className="text-caption text-[var(--color-text-3)]">PDF or Word · up to 10 MB</span>
      </button>
      <input
        ref={inputRef}
        type="file"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        accept={[...RESUME_FILE.extensions, ...RESUME_FILE.mimeTypes].join(",")}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) read(file);
        }}
      />

      {problem ? <p role="alert" className="text-sm text-[var(--color-danger-fg)]">{problem}</p> : null}
      {parse.error && !problem ? (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-[var(--radius-lg)] border border-[var(--color-danger-fg)] bg-[var(--color-danger-bg)] p-3">
          <p className="flex-1 text-sm text-[var(--color-danger-fg)]">Couldn&apos;t read this résumé. Try another file, or enter the details yourself.</p>
          {lastFile ? <Button size="sm" variant="secondary" onClick={() => read(lastFile)}>Try again</Button> : null}
          <Button size="sm" variant="ghost" onClick={() => wizard.goTo("basic")}>Skip</Button>
        </div>
      ) : null}

      {samples.data && samples.data.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Sample résumés">
          <span className="inline-flex items-center gap-1 text-caption text-[var(--color-text-3)]"><WandSparkles size={12} aria-hidden />Try a sample</span>
          {samples.data.map((name) => (
            <button key={name} type="button" onClick={() => read(new File([], name, { type: name.endsWith(".pdf") ? "application/pdf" : RESUME_FILE.mimeTypes[2] }))} className="bq-choice items-center gap-1.5 px-2 py-1 font-mono text-caption">
              <FileText size={12} aria-hidden />
              {name}
            </button>
          ))}
        </div>
      ) : null}

      <div className={cn("flex flex-wrap items-center justify-between gap-3 border-t border-[var(--color-border)] pt-4")}>
        <p className="inline-flex items-center gap-2 text-sm text-[var(--color-text-2)]">
          <PencilLine size={14} aria-hidden />
          No resume yet? You can add one later from the candidate&apos;s Resumes tab.
        </p>
        <Button variant="ghost" onClick={() => wizard.goTo("basic")}>Skip, enter manually</Button>
      </div>
    </div>
  );
}
