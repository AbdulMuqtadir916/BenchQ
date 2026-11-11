"use client";

import { useEffect, useRef } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { ResumeDocument, RichText } from "@/lib/schemas/resume-document";
import { newText } from "@/lib/resume-doc/build";
import { addBullet } from "@/lib/resume-doc/ops";
import { escapeHtml } from "@/lib/resume-doc/rich-text";
import { AgentRunPanel, useAgentRun } from "@/components/app/ai";
import { EASE_OUT } from "@/lib/motion";
import { useStudio } from "./studio-store";

const STAGES = ["Reading the candidate record", "Extracting job requirements", "Matching experience", "Drafting tailored bullets"] as const;

const DRAFT_BULLETS = [
  "Rearchitected the release pipeline, cutting mean deploy time from 40 to 9 minutes.",
  "Partnered with product and QA to ship quarterly roadmap features ahead of schedule.",
];

/** "Tailor with AI" — staged agent theatre, then drafts land in the document. */
export function useTailorRun() {
  const run = useAgentRun(STAGES.length);
  const applied = useRef(false);

  useEffect(() => {
    if (run.status !== "complete" || applied.current) return;
    applied.current = true;
    const { doc, update, flash, notify, toggleSection, toggleEntry } = useStudio.getState();
    const first = doc?.experience[0];
    if (!doc) return;
    const summary: RichText = { ...doc.summary, html: escapeHtml(`${doc.title || "Engineer"} with a record of shipping reliable, high-throughput services; recently focused on cloud migration and release automation.`) };
    const bullets = DRAFT_BULLETS.map((text) => newText(escapeHtml(text)));
    update((d) => bullets.reduce<ResumeDocument>((acc, b) => (first ? addBullet(acc, "experience", first.id, b) : acc), { ...d, summary }));
    toggleSection("summary", true);
    if (first) {
      toggleSection("experience", true);
      toggleEntry(first.id, true);
    }
    flash(first ? bullets[0]!.id : summary.id);
    notify(`${first ? 3 : 1} tailored drafts added. Read them over before you send.`, "ai");
  }, [run.status]);

  return {
    isRunning: run.status === "running",
    start: () => {
      applied.current = false;
      run.start();
    },
    panel: <TailorPanel run={run} />,
  };
}

function TailorPanel({ run }: { run: ReturnType<typeof useAgentRun> }) {
  const reduce = useReducedMotion() ?? false;
  const isVisible = run.status === "running" || run.status === "fallback";
  return (
    <AnimatePresence>
      {isVisible ? (
        <motion.div
          initial={reduce ? false : { opacity: 0, y: 12, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8 }}
          transition={{ duration: 0.22, ease: EASE_OUT }}
          className="fixed bottom-16 right-4 z-[60] w-80 shadow-[var(--shadow-lg)]"
        >
          <AgentRunPanel
            title="Tailoring the resume"
            stages={STAGES}
            activeStage={run.activeStage}
            status={run.status}
            elapsedMs={run.elapsedMs}
            onCancel={run.reset}
            fallbackMessage="AI tailoring is unavailable. Keep editing manually — nothing is lost."
          />
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
