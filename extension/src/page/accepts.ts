/** Whether an upload's `accept` list takes a file: by its type, its extension (from the type, else its name) or a
 * wildcard. An empty list takes anything. The page's own copy of the panel's rule (autofill/documents.ts `accepts`):
 * page.js has to stand alone, and a test keeps the two the same. The page looks once more right before writing a file,
 * since it can change the list after the scan. */
const EXTENSIONS: Record<string, string> = {
  "application/pdf": ".pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
  "application/msword": ".doc",
};

export function accepts(accept: string | undefined, mimeType: string, name = ""): boolean {
  const kinds = (accept ?? "").toLowerCase().split(",").map((kind) => kind.trim()).filter(Boolean);
  if (kinds.length === 0) return true;
  const extension = EXTENSIONS[mimeType] ?? /\.[a-z0-9]+$/i.exec(name)?.[0]?.toLowerCase() ?? "";
  return kinds.some((kind) => kind === mimeType || (extension !== "" && kind === extension) || kind === "*/*"
    || kind === `${mimeType.split("/")[0]}/*`);
}
