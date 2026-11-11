import type { BulletSection, ResumeDocument, ResumeListKey, RichText } from "@/lib/schemas/resume-document";

/** Pure, immutable edits on the builder document. The store wires these to state. */

type Entry<K extends ResumeListKey> = ResumeDocument[K][number];

export function patchEntry<K extends ResumeListKey>(doc: ResumeDocument, key: K, id: string, patch: Partial<Entry<K>>): ResumeDocument {
  const list = doc[key] as Entry<K>[];
  return { ...doc, [key]: list.map((e) => (e.id === id ? { ...e, ...patch } : e)) };
}

export function addEntry<K extends ResumeListKey>(doc: ResumeDocument, key: K, entry: Entry<K>): ResumeDocument {
  return { ...doc, [key]: [...(doc[key] as Entry<K>[]), entry] };
}

export function removeEntry(doc: ResumeDocument, key: ResumeListKey, id: string): ResumeDocument {
  return { ...doc, [key]: (doc[key] as Array<{ id: string }>).filter((e) => e.id !== id) };
}

export function moveEntry(doc: ResumeDocument, key: ResumeListKey, id: string, dir: -1 | 1): ResumeDocument {
  const list = [...(doc[key] as Array<{ id: string }>)];
  const from = list.findIndex((e) => e.id === id);
  const to = from + dir;
  if (from < 0 || to < 0 || to >= list.length) return doc;
  [list[from], list[to]] = [list[to]!, list[from]!];
  return { ...doc, [key]: list };
}

/** Every rich-text field in the document (summary, then every bullet of a job or a project), in reading order. */
export function allText(doc: ResumeDocument): Array<{ text: RichText; section: "summary" | BulletSection; entryId: string | null }> {
  return [
    { text: doc.summary, section: "summary" as const, entryId: null },
    ...doc.experience.flatMap((e) => e.bullets.map((text) => ({ text, section: "experience" as const, entryId: e.id }))),
    ...doc.projects.flatMap((p) => p.bullets.map((text) => ({ text, section: "projects" as const, entryId: p.id }))),
  ];
}

function mapBullets<E extends { bullets: RichText[] }>(entries: E[], fn: (bullets: RichText[], entry: E) => RichText[]): E[] {
  return entries.map((e) => {
    const bullets = fn(e.bullets, e);
    return bullets === e.bullets ? e : { ...e, bullets };
  });
}

/** Apply `fn` to the rich-text field with this id, wherever it lives. */
export function updateText(doc: ResumeDocument, textId: string, fn: (t: RichText) => RichText): ResumeDocument {
  if (doc.summary.id === textId) return { ...doc, summary: fn(doc.summary) };
  const each = (bullets: RichText[]) => (bullets.some((b) => b.id === textId) ? bullets.map((b) => (b.id === textId ? fn(b) : b)) : bullets);
  return { ...doc, experience: mapBullets(doc.experience, each), projects: mapBullets(doc.projects, each) };
}

/** Append a bullet to a job or project, or insert it right after `afterId` (Enter in the inline editor). */
export function addBullet(doc: ResumeDocument, section: BulletSection, entryId: string, bullet: RichText, afterId?: string): ResumeDocument {
  const add = (bullets: RichText[], entry: { id: string }) => {
    if (entry.id !== entryId) return bullets;
    const at = afterId ? bullets.findIndex((b) => b.id === afterId) + 1 : bullets.length;
    const next = [...bullets];
    next.splice(at > 0 ? at : next.length, 0, bullet);
    return next;
  };
  return section === "experience" ? { ...doc, experience: mapBullets(doc.experience, add) } : { ...doc, projects: mapBullets(doc.projects, add) };
}

export function removeBullet(doc: ResumeDocument, section: BulletSection, entryId: string, bulletId: string): ResumeDocument {
  const drop = (bullets: RichText[], entry: { id: string }) => (entry.id === entryId ? bullets.filter((b) => b.id !== bulletId) : bullets);
  return section === "experience" ? { ...doc, experience: mapBullets(doc.experience, drop) } : { ...doc, projects: mapBullets(doc.projects, drop) };
}
