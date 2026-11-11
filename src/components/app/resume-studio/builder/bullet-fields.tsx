"use client";

import type { BulletSection, RichText } from "@/lib/schemas/resume-document";
import { newText } from "@/lib/resume-doc/build";
import { useDocActions } from "../use-doc-actions";
import { useStudio } from "../studio-store";
import { AddButton, FieldLabel } from "./fields";
import { RichField } from "./rich-field";

/** The bullets of one job or project: Enter starts the next one, Backspace in an empty one drops it. */
export function BulletFields({ section, entryId, bullets }: { section: BulletSection; entryId: string; bullets: RichText[] }) {
  const a = useDocActions();
  const requestFocus = useStudio((s) => s.requestFocus);

  function addAfter(afterId?: string) {
    const bullet = newText();
    a.addBullet(section, entryId, bullet, afterId);
    requestFocus(bullet.id);
  }

  return (
    <div>
      <FieldLabel hint="Enter adds the next bullet">Bullets</FieldLabel>
      <div className="space-y-3">
        {bullets.map((b, i) => (
          <RichField
            key={b.id}
            field={b}
            label={`Bullet ${i + 1}`}
            placeholder="Start with an action verb and end with the result"
            onRemove={() => a.removeBullet(section, entryId, b.id)}
            onEnter={() => addAfter(b.id)}
            onBackspaceEmpty={() => a.removeBullet(section, entryId, b.id)}
          />
        ))}
      </div>
      <div className="mt-2"><AddButton onClick={() => addAfter()}>Add bullet</AddButton></div>
    </div>
  );
}
