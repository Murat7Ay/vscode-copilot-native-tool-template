/**
 * Shared vocabulary of the template. Nothing in `src/core` or `src/tools` imports `vscode`;
 * the VS Code integration lives in `src/host` (enforced by ESLint).
 */

/** Architectural risk category. Guidance for reviewers; NOT a replacement for VS Code's permission model. */
export type ToolCategory =
  /** Reads information. No side effects. */
  | 'read'
  /** Computes a proposal (configuration, plan, diff) without changing anything. */
  | 'prepare'
  /** Changes state: files, configuration, external systems. */
  | 'mutate';

export interface ValidationIssue {
  /** Input field the issue belongs to, if any. Used by forms to show the error next to the field. */
  readonly field?: string;
  readonly message: string;
}

export type Validation<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly issues: readonly ValidationIssue[] };

export const valid = <T>(value: T): Validation<T> => ({ ok: true, value });
export const invalid = <T = never>(...issues: ValidationIssue[]): Validation<T> => ({ ok: false, issues });

/** Minimal cancellation contract. `vscode.CancellationToken` satisfies it structurally. */
export interface Cancellation {
  readonly isCancellationRequested: boolean;
}

export class CancelledError extends Error {
  constructor() {
    super('The operation was cancelled.');
    this.name = 'CancelledError';
  }
}

export function throwIfCancelled(token: Cancellation): void {
  if (token.isCancellationRequested) {
    throw new CancelledError();
  }
}

/** Effect a planned operation has on a resource. Shown to the human before approval. */
export type ResourceEffect = 'read' | 'create' | 'update' | 'overwrite' | 'none';

/**
 * Human-readable description of what an operation will do. Built by each tool from its
 * validated proposal and rendered by the host into a confirmation message or a modal.
 */
export interface OperationSummary {
  /** Short imperative title, e.g. `Create note "Release checklist"`. */
  readonly title: string;
  /** Whether approving this operation changes any state. */
  readonly changesState: boolean;
  /** Resources the operation touches. */
  readonly resources: readonly { readonly path: string; readonly effect: ResourceEffect }[];
  /** Important parameters as label/value pairs. Values are treated as untrusted text and escaped. */
  readonly parameters: readonly (readonly [label: string, value: string])[];
  /** Extra warnings, e.g. "An existing file will be replaced". */
  readonly warnings?: readonly string[];
}

/** What a tool returns after executing an approved operation. Sent back to the language model. */
export interface ExecutionResult {
  /** One or two sentences for the model (and the user) describing what happened. */
  readonly message: string;
  /** Optional structured data for the model. Never put secrets or credentials here. */
  readonly data?: Readonly<Record<string, unknown>>;
}
