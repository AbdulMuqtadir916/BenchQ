/**
 * Inline rich text for resume lines. The editor is a contentEditable, so
 * anything the browser inserts (spans, styles, pasted markup) is reduced to
 * bold / italic / underline / line breaks before it reaches the document.
 */
const ALLOWED: Record<string, string> = { B: "b", STRONG: "b", I: "i", EM: "i", U: "u", BR: "br" };

export function sanitizeRichText(html: string): string {
  if (typeof document === "undefined") return escapeHtml(stripTags(html));
  const root = document.createElement("template");
  root.innerHTML = html;
  return serialize(root.content).replace(/(<br>)+$/, "");
}

function serialize(node: Node): string {
  let out = "";
  node.childNodes.forEach((child) => {
    if (child.nodeType === Node.TEXT_NODE) {
      out += escapeHtml(child.textContent ?? "");
      return;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) return;
    const tag = ALLOWED[(child as Element).tagName];
    const inner = serialize(child);
    if (tag === "br") out += "<br>";
    else if (tag) out += inner ? `<${tag}>${inner}</${tag}>` : "";
    else if ((child as Element).tagName === "DIV" || (child as Element).tagName === "P") out += out ? `<br>${inner}` : inner;
    else out += inner;
  });
  return out;
}

export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Plain text of a rich field — for counts, search and ATS checks. */
export function stripTags(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

export function isBlank(html: string): boolean {
  return stripTags(html).length === 0;
}
