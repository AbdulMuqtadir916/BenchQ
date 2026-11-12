"use client";

import { useEffect, useRef, useState } from "react";

/**
 * A search box's text, held here while it is typed and written to the URL a moment later. The URL is state that
 * changes in a transition, which can't drive a controlled input: typing fast would drop characters. If the URL changes
 * from somewhere else (back, a link), the box follows it.
 */
export function useSearchText(urlValue: string, commit: (next: string) => void, delayMs = 250) {
  const [text, setText] = useState(urlValue);
  // The last value this box wrote to, or read from, the URL: the URL echoing it back is not a change from elsewhere.
  const settled = useRef(urlValue);
  const latestCommit = useRef(commit);
  useEffect(() => { latestCommit.current = commit; }, [commit]);

  useEffect(() => {
    if (urlValue === settled.current) return;
    settled.current = urlValue;
    setText(urlValue);
  }, [urlValue]);

  useEffect(() => {
    if (text === settled.current) return;
    const timer = window.setTimeout(() => {
      settled.current = text;
      latestCommit.current(text);
    }, delayMs);
    return () => window.clearTimeout(timer);
  }, [text, delayMs]);

  return [text, setText] as const;
}
