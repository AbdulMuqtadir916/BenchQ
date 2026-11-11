import { describeJob } from "@/lib/format/job-description";

/**
 * A job's description laid out from the structure its text has (src/lib/format/job-description.ts): the job's facts,
 * headings, bullet lists and paragraphs. The job's preview and its page both show it this way.
 */
export function JobDescription({ text }: { text: string }) {
  const blocks = describeJob(text);
  return (
    <div className="space-y-3 text-sm leading-6 text-[var(--color-text-2)]">
      {blocks.map((block, index) => {
        if (block.kind === "heading") return <h4 key={index} className="pt-2 text-body-strong text-[var(--color-text)]">{block.text}</h4>;
        if (block.kind === "paragraph") return <p key={index}>{block.text}</p>;
        if (block.kind === "bullets") {
          return (
            <ul key={index} className="space-y-1.5">
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex} className="flex gap-2"><span aria-hidden className="mt-[9px] h-1 w-1 shrink-0 rounded-[var(--radius-full)] bg-[var(--color-primary)]" /><span>{item}</span></li>
              ))}
            </ul>
          );
        }
        return (
          <dl key={index} className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-[var(--radius-md)] bg-[var(--color-surface-2)] px-3 py-2.5">
            {block.items.map((item) => (
              <div key={item.label} className="contents">
                <dt className="text-caption text-[var(--color-text-3)]">{item.label}</dt>
                <dd className="text-sm text-[var(--color-text)]">{item.value}</dd>
              </div>
            ))}
          </dl>
        );
      })}
    </div>
  );
}
