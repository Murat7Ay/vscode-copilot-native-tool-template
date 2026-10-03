import type { ValidationIssue } from './types';

/**
 * UI-independent model of a review form. The host renders it (QuickPick today; a Webview
 * could render the same model), but field origins, parsing and validation live here so they
 * are unit-tested and identical whatever the UI.
 */

export type FieldKind = 'text' | 'choice' | 'integer' | 'list';

export interface FieldSpec<TInput> {
  readonly key: keyof TInput & string;
  readonly label: string;
  readonly kind: FieldKind;
  /** Required for submission. Enforced by the form even if the input schema leaves it optional for the AI. */
  readonly required?: boolean;
  /** Allowed values for `choice` fields. */
  readonly options?: readonly string[];
  /** Value used when the AI did not provide one. Shown as "default", not "AI suggested". */
  readonly defaultValue?: unknown;
  /** Short hint shown while editing. */
  readonly help?: string;
}

export interface FormSpec<TInput> {
  readonly title: string;
  readonly fields: readonly FieldSpec<TInput>[];
}

/** Where a field's current value came from. Shown next to every field in the form. */
export type FieldOrigin = 'ai' | 'user' | 'default' | 'empty';

export interface FormState {
  readonly values: Readonly<Record<string, unknown>>;
  readonly origins: Readonly<Record<string, FieldOrigin>>;
  /** The AI's original values, so a field can be reset and edits can be reported. */
  readonly aiValues: Readonly<Record<string, unknown>>;
}

export function createFormState<TInput>(spec: FormSpec<TInput>, aiInput: Partial<TInput>): FormState {
  const values: Record<string, unknown> = {};
  const origins: Record<string, FieldOrigin> = {};
  const aiValues: Record<string, unknown> = {};
  const source = aiInput as Record<string, unknown>;
  for (const field of spec.fields) {
    const aiValue = source[field.key];
    if (!isEmpty(aiValue)) {
      values[field.key] = aiValue;
      aiValues[field.key] = aiValue;
      origins[field.key] = 'ai';
    } else if (field.defaultValue !== undefined) {
      values[field.key] = field.defaultValue;
      origins[field.key] = 'default';
    } else {
      origins[field.key] = 'empty';
    }
  }
  return { values, origins, aiValues };
}

/** Returns a new state with one field changed by the human. Setting a field back to the AI value restores its 'ai' origin. */
export function editField(state: FormState, key: string, value: unknown): FormState {
  const values = { ...state.values };
  const origins = { ...state.origins };
  if (isEmpty(value)) {
    delete values[key];
    origins[key] = 'empty';
  } else {
    values[key] = value;
    origins[key] = key in state.aiValues && sameValue(state.aiValues[key], value) ? 'ai' : 'user';
  }
  return { values, origins, aiValues: state.aiValues };
}

/** Checks `required` fields. Combined with schema and business validation by the pipeline. */
export function requiredIssues<TInput>(spec: FormSpec<TInput>, values: Readonly<Record<string, unknown>>): ValidationIssue[] {
  return spec.fields
    .filter((f) => f.required && isEmpty(values[f.key]))
    .map((f) => ({ field: f.key, message: `${f.label} is required` }));
}

/** Groups issues by top-level field key (`tags[2]` → `tags`). Issues without a field go under ''. */
export function issuesByField(issues: readonly ValidationIssue[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const issue of issues) {
    const key = issue.field?.split(/[.[]/)[0] ?? '';
    map.set(key, [...(map.get(key) ?? []), issue.message]);
  }
  return map;
}

/** Parses text typed by the human into the field's value type. Empty text clears the field. */
export function parseFieldText<TInput>(field: FieldSpec<TInput>, text: string): { ok: true; value: unknown } | { ok: false; message: string } {
  const trimmed = text.trim();
  if (trimmed === '') {
    return { ok: true, value: undefined };
  }
  switch (field.kind) {
    case 'text':
      return { ok: true, value: trimmed };
    case 'integer':
      return /^-?\d+$/.test(trimmed) ? { ok: true, value: Number(trimmed) } : { ok: false, message: 'Enter a whole number' };
    case 'list':
      return { ok: true, value: trimmed.split(',').map((s) => s.trim()).filter((s) => s !== '') };
    case 'choice':
      return field.options?.includes(trimmed) ? { ok: true, value: trimmed } : { ok: false, message: `Choose one of: ${(field.options ?? []).join(', ')}` };
  }
}

export function formatFieldValue(value: unknown): string {
  if (isEmpty(value)) {
    return '';
  }
  return Array.isArray(value) ? value.join(', ') : String(value);
}

/** Which fields kept the AI value, were edited by the human, defaulted, or left empty. Reported back to the model. */
export function summarizeOrigins(state: FormState): Record<FieldOrigin, string[]> {
  const summary: Record<FieldOrigin, string[]> = { ai: [], user: [], default: [], empty: [] };
  for (const [key, origin] of Object.entries(state.origins)) {
    summary[origin].push(key);
  }
  return summary;
}

function isEmpty(value: unknown): boolean {
  return value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0);
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
