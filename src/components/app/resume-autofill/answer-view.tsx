"use client";

import { useState } from "react";
import { Tag } from "@/components/ui/tag";
import { displayAnswer, recordLines } from "@/lib/derive/autofill-view";
import type { AutofillAnswer } from "@/lib/schemas/resume-autofill";

const SHOWN_ITEMS = 12;
const SHOWN_RECORDS = 4;

/**
 * An answer as the extension writes it: a line of text, a list as tags, a list of records (the work history…) as two
 * lines each. A long list shows its first items and "Show all". No answer reads "Not answered".
 */
export function AnswerView({ answerKey, answer }: { answerKey: string | null; answer: AutofillAnswer | undefined }) {
  const [isAll, setIsAll] = useState(false);
  if (answer === null || answer === undefined) return <p className="text-body text-[var(--color-text-3)]">Not answered</p>;

  if (Array.isArray(answer) && answer.length > 0 && typeof answer[0] === "object") {
    const records = answer.filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null);
    const shown = isAll ? records : records.slice(0, SHOWN_RECORDS);
    return (
      <div className="mt-1 space-y-1.5">
        <ul className="space-y-1.5">
          {shown.map((record, index) => {
            const [first, second] = recordLines(answerKey, record);
            return (
              <li key={index} className="border-l-2 border-[var(--color-border-strong)] pl-2.5">
                <p className="text-body-strong text-[var(--color-text)] break-words">{first}</p>
                {second ? <p className="text-sm text-[var(--color-text-3)] break-words">{second}</p> : null}
              </li>
            );
          })}
        </ul>
        <More count={records.length} limit={SHOWN_RECORDS} isAll={isAll} onToggle={() => setIsAll(!isAll)} />
      </div>
    );
  }

  if (Array.isArray(answer)) {
    const items = answer.filter((item): item is string => typeof item === "string" && item.trim() !== "");
    if (items.length === 0) return <p className="text-body text-[var(--color-text-3)]">Not answered</p>;
    const shown = isAll ? items : items.slice(0, SHOWN_ITEMS);
    return (
      <div className="mt-1 flex flex-wrap items-center gap-1.5">
        {shown.map((item, index) => <Tag key={`${item}-${index}`}>{item}</Tag>)}
        <More count={items.length} limit={SHOWN_ITEMS} isAll={isAll} onToggle={() => setIsAll(!isAll)} />
      </div>
    );
  }

  return <p className="text-body-strong text-[var(--color-text)] break-words whitespace-pre-line">{displayAnswer(answerKey, answer)}</p>;
}

function More({ count, limit, isAll, onToggle }: { count: number; limit: number; isAll: boolean; onToggle: () => void }) {
  if (count <= limit) return null;
  return (
    <button type="button" onClick={onToggle} aria-expanded={isAll}
      className="text-sm text-[var(--color-primary-subtle-fg)] hover:underline focus-visible:underline">
      {isAll ? "Show fewer" : `Show all ${count}`}
    </button>
  );
}
