"use client";

import { createContext, useContext, useEffect, useLayoutEffect, useRef, type ElementType } from "react";
import { sanitizeRichText } from "@/lib/resume-doc/rich-text";
import { cn } from "@/lib/cn";
import { useStudio } from "./studio-store";

/**
 * True inside the paper's off-screen measuring copy: fields keep their size (placeholders included) but aren't
 * editable, focusable or addressable, so the copy never takes focus or a field id from the real page.
 */
export const PaperMeasureContext = createContext(false);

interface EditableTextProps {
  value: string;
  onChange: (value: string) => void;
  /** Rich fields keep bold / italic / underline and get the selection toolbar. */
  rich?: boolean;
  as?: ElementType;
  editable?: boolean;
  label: string;
  placeholder?: string;
  className?: string;
  fieldId?: string;
  invalidDescriptionId?: string;
  onBlur?: () => void;
  /** Enter (without Shift) in a rich field — e.g. start the next bullet. */
  onEnter?: () => void;
  /** Backspace in an already-empty field — e.g. drop the bullet. */
  onBackspaceEmpty?: () => void;
}

/**
 * One contentEditable used by both modes — boxed in the builder, inline on the
 * paper. Uncontrolled while focused: the DOM is only rewritten when the value
 * changed from outside, so the caret never jumps.
 */
export function EditableText({
  value,
  onChange,
  rich = false,
  as: Tag = "span",
  editable = true,
  label,
  placeholder,
  className,
  fieldId,
  invalidDescriptionId,
  onBlur,
  onEnter,
  onBackspaceEmpty,
}: EditableTextProps) {
  const ref = useRef<HTMLElement>(null);
  const isMeasuring = useContext(PaperMeasureContext);
  const isFlashing = useStudio((s) => !isMeasuring && !!fieldId && s.flashId === fieldId);
  const focusRequest = useStudio((s) => s.focusRequest);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const current = rich ? sanitizeRichText(el.innerHTML) : (el.textContent ?? "");
    if (current === value) return;
    if (rich) el.innerHTML = value;
    else el.textContent = value;
  }, [value, rich, editable]);

  useEffect(() => {
    const el = ref.current;
    if (!el || isMeasuring || !fieldId || focusRequest?.fieldId !== fieldId) return;
    if (Date.now() - focusRequest.nonce > 1500) return;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    el.focus({ preventScroll: true });
  }, [focusRequest, fieldId, isMeasuring]);

  const shared = {
    ref,
    className: cn(isFlashing && "bq-flash", className),
    "data-field-id": fieldId,
  };

  if (isMeasuring) return <Tag ref={ref} className={className} data-editable={editable ? "" : undefined} data-placeholder={editable ? (placeholder ?? label) : undefined} />;
  if (!editable) return <Tag {...shared} />;

  return (
    <Tag
      {...shared}
      contentEditable
      suppressContentEditableWarning
      role="textbox"
      tabIndex={0}
      aria-label={label}
      aria-multiline={rich}
      aria-invalid={invalidDescriptionId ? true : undefined}
      aria-describedby={invalidDescriptionId}
      onBlur={onBlur}
      spellCheck
      data-editable=""
      data-rich-field={rich ? "" : undefined}
      data-placeholder={placeholder ?? label}
      onInput={(e: React.FormEvent<HTMLElement>) => {
        const el = e.currentTarget;
        const next = rich ? sanitizeRichText(el.innerHTML) : (el.textContent ?? "");
        if (!next && el.innerHTML) el.innerHTML = "";
        onChange(next);
      }}
      onKeyDown={(e: React.KeyboardEvent<HTMLElement>) => {
        if (e.key === "Escape") {
          e.currentTarget.blur();
          e.stopPropagation();
        }
        if (onEnter && e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          onEnter();
          return;
        }
        if (onBackspaceEmpty && e.key === "Backspace" && !e.currentTarget.textContent) {
          e.preventDefault();
          onBackspaceEmpty();
          return;
        }
        if (!rich && e.key === "Enter") {
          e.preventDefault();
          e.currentTarget.blur();
        }
        if (!rich && (e.metaKey || e.ctrlKey) && ["b", "i", "u"].includes(e.key.toLowerCase())) e.preventDefault();
      }}
      onPaste={(e: React.ClipboardEvent<HTMLElement>) => {
        e.preventDefault();
        const text = e.clipboardData.getData("text/plain");
        document.execCommand("insertText", false, rich ? text : text.replace(/\s+/g, " "));
      }}
    />
  );
}
