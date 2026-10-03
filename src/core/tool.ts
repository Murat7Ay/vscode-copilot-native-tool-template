import type { FormSpec } from './form';
import type { Approved } from './pipeline';
import type { Cancellation, ExecutionResult, OperationSummary, ToolCategory, Validation } from './types';
import type { WorkspacePort } from './workspace';

/**
 * How a validated proposal is reviewed by a human before execution.
 *
 * - `none`: no human review. Only allowed for `read` and `prepare` tools.
 * - `vscodeConfirmation`: VS Code's native tool confirmation, requested via
 *   `prepareInvocation().confirmationMessages`. The user or organization can configure
 *   VS Code to auto-approve it (see docs/APPROVAL-AND-SECURITY.md).
 * - `extensionConfirmation`: a modal dialog shown by this extension inside `invoke()`.
 *   VS Code tool auto-approval cannot skip it.
 * - `form`: a review form shown by this extension inside `invoke()`, pre-filled with the
 *   AI's values. VS Code tool auto-approval cannot skip it.
 */
export type ReviewPolicy<TInput> =
  | { readonly kind: 'none' }
  | { readonly kind: 'vscodeConfirmation' }
  | { readonly kind: 'extensionConfirmation' }
  | { readonly kind: 'form'; readonly form: FormSpec<TInput> };

/** Review policies that may be chosen per proposal (forms are chosen statically). */
export type ConfirmationPolicy = Exclude<ReviewPolicy<never>, { kind: 'form' }>;

export interface ToolContext {
  readonly workspace: WorkspacePort;
  readonly token: Cancellation;
}

/**
 * Everything a developer implements for one tool. The pipeline (`runTool`) owns the order:
 * schema validation → propose → human review → execute. A tool never calls its own
 * `execute`, and `execute` only accepts an `Approved<TProposal>` minted by the pipeline.
 *
 * @typeParam TInput    Shape of the tool input, matching `inputSchema` in package.json.
 * @typeParam TProposal Validated, normalized, enriched proposal that a human reviews.
 */
export interface ToolDefinition<TInput, TProposal> {
  /** Must equal the `name` of a `contributes.languageModelTools` entry in package.json. */
  readonly name: string;
  readonly category: ToolCategory;
  /**
   * Business validation, normalization and enrichment of schema-valid input. Must be free of
   * side effects: it also runs during `prepareInvocation` and again for every form edit.
   * For form tools, input fields may be missing (declare them optional in `TInput`).
   */
  propose(input: TInput, context: ToolContext): Validation<TProposal> | Promise<Validation<TProposal>>;
  /** Human-readable description of what executing the proposal will do. Required unless the review is a form. */
  describe?(proposal: TProposal): OperationSummary;
  /** Static policy, or a function choosing a confirmation per proposal (e.g. stricter for overwrites). */
  readonly review: ReviewPolicy<TInput> | ((proposal: TProposal) => ConfirmationPolicy);
  /** Performs the approved operation. Receives the value the human approved, frozen. */
  execute(approved: Approved<TProposal>, context: ToolContext): Promise<ExecutionResult>;
}

/**
 * Declares a tool and enforces template rules at definition time, so mistakes fail on
 * activation and in unit tests rather than in front of a user.
 */
export function defineTool<TInput, TProposal>(definition: ToolDefinition<TInput, TProposal>): ToolDefinition<TInput, TProposal> {
  if (!/^[\w-]+$/.test(definition.name) || /^(copilot_|vscode_)/.test(definition.name)) {
    throw new Error(`Tool name '${definition.name}' must match ^[\\w-]+$ and must not start with copilot_ or vscode_.`);
  }
  if (definition.category === 'mutate' && typeof definition.review !== 'function' && definition.review.kind === 'none') {
    throw new Error(`Tool '${definition.name}' is a 'mutate' tool and must declare a human review policy, not 'none'.`);
  }
  const isForm = typeof definition.review !== 'function' && definition.review.kind === 'form';
  if (!isForm && !definition.describe) {
    throw new Error(`Tool '${definition.name}' must implement describe() so humans can see what it will do.`);
  }
  return definition;
}

// The registry stores tools with different type parameters side by side.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyToolDefinition = ToolDefinition<any, any>;
