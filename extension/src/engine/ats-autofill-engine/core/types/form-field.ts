// SPDX-License-Identifier: MIT
/** The raw HTML form-control type, orthogonal to the semantic FieldType. */
export type HtmlType =
  | 'text'
  | 'email'
  | 'tel'
  | 'url'
  | 'file'
  | 'select-one'
  | 'textarea'
  | 'checkbox'
  | 'radio'
  | 'date'
  | 'number';

/** A single form field snapshot: plain strings, no references to live DOM nodes. */
export interface FormField {
  readonly label?: string;
  readonly placeholder?: string;
  readonly htmlType: HtmlType;
  readonly ariaLabel?: string;
  readonly autocomplete?: string;
  readonly name?: string;
  readonly id?: string;
}
