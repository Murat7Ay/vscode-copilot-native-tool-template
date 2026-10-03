import { createFormState, requiredIssues, summarizeOrigins, type FieldOrigin, type FieldSpec, type FormState } from './form';
import type { ConfirmationLedger } from './ledger';
import { validateSchema, type JsonSchema } from './schema';
import type { AnyToolDefinition, ReviewPolicy, ToolContext } from './tool';
import { throwIfCancelled, type Cancellation, type ExecutionResult, type OperationSummary, type ValidationIssue } from './types';
import type { WorkspacePort } from './workspace';

/**
 * The single path from "the AI proposed something" to "the system did something":
 *
 *   untrusted input → schema validation → propose (business validation) → human review
 *   → Approved<T> (minted only here) → execute
 *
 * Tools never call `execute` themselves. `Approved` values can only be created inside this
 * module, and `executeApproved` refuses anything it did not mint, so a rejected, cancelled or
 * forged proposal cannot reach an executor.
 */

export type ReviewDecision = 'approved' | 'declined' | 'cancelled';

/** UI the pipeline needs from the host. Implemented with VS Code in `src/host`, faked in tests. */
export interface ReviewGateway {
  /** Extension-owned confirmation (modal). Must resolve 'approved' only on an explicit human action. */
  confirm(summary: OperationSummary, token: Cancellation): Promise<ReviewDecision>;
  /** Extension-owned review form. Must resolve 'approved' only when the human submits a form without issues. */
  reviewForm(session: FormSession, token: Cancellation): Promise<FormReview>;
}

export interface FormSession {
  readonly title: string;
  readonly fields: readonly FieldSpec<Record<string, unknown>>[];
  readonly initial: FormState;
  /** Full validation of the current values: schema, required fields and the tool's business rules. */
  validate(values: Readonly<Record<string, unknown>>): Promise<ValidationIssue[]>;
}

export type FormReview =
  | { readonly decision: 'approved'; readonly state: FormState }
  | { readonly decision: 'declined' | 'cancelled' };

/** How approval was obtained. Recorded with every executed operation. */
export type ApprovalSource =
  /** read/prepare tool with review 'none'. */
  | 'not-required'
  /** VS Code's tool confirmation was requested. The user or organization may have configured VS Code to auto-approve it. */
  | 'vscode-confirmation'
  /** This extension's modal confirmation. */
  | 'extension-confirmation'
  /** This extension's review form. */
  | 'extension-form';

export interface ApprovalRecord {
  readonly source: ApprovalSource;
  readonly approvedAt: string;
  /** For forms: which fields kept the AI value, were edited by the human, defaulted, or left empty. */
  readonly fields?: Readonly<Record<FieldOrigin, string[]>>;
}

declare const approvedBrand: unique symbol;

/** A proposal a human approved (or that needed no approval). Frozen; only `runTool` can create one. */
export interface Approved<T> {
  readonly proposal: Readonly<T>;
  readonly approval: ApprovalRecord;
  readonly [approvedBrand]: true;
}

const minted = new WeakSet<object>();

function mint<T>(proposal: T, approval: Omit<ApprovalRecord, 'approvedAt'>): Approved<T> {
  const approved = Object.freeze({
    proposal: deepFreeze(proposal),
    approval: Object.freeze({ ...approval, approvedAt: new Date().toISOString() }),
  }) as unknown as Approved<T>;
  minted.add(approved);
  return approved;
}

export function isApproved(value: unknown): boolean {
  return typeof value === 'object' && value !== null && minted.has(value);
}

export interface PipelineOptions {
  readonly workspace: WorkspacePort;
  readonly gateway: ReviewGateway;
  readonly ledger: ConfirmationLedger;
  /** Replace 'vscodeConfirmation' with 'extensionConfirmation' (setting `approval.requireExtensionConfirmation`). */
  readonly requireExtensionConfirmation: boolean;
}

export type ToolOutcome =
  | { readonly status: 'invalid'; readonly issues: readonly ValidationIssue[] }
  | { readonly status: 'rejected'; readonly decision: 'declined' | 'cancelled' }
  | { readonly status: 'executed'; readonly result: ExecutionResult; readonly approval: ApprovalRecord };

export type Preparation =
  | { readonly kind: 'invalid'; readonly issues: readonly ValidationIssue[] }
  | { readonly kind: 'form'; readonly title: string }
  | { readonly kind: 'ready'; readonly summary: OperationSummary; readonly review: ReviewPolicy<never>['kind'] };

/**
 * Side-effect-free analysis for `prepareInvocation`. Records in the ledger when it decides
 * that VS Code's confirmation is required, so `runTool` can trust that confirmation later.
 */
export async function prepareTool(
  tool: AnyToolDefinition, schema: JsonSchema, input: unknown, options: PipelineOptions, token: Cancellation,
): Promise<Preparation> {
  const schemaIssues = validateSchema(schema, input);
  if (schemaIssues.length > 0) {
    return { kind: 'invalid', issues: schemaIssues };
  }
  if (typeof tool.review !== 'function' && tool.review.kind === 'form') {
    return { kind: 'form', title: tool.review.form.title };
  }
  const proposal = await tool.propose(input, context(options, token));
  if (!proposal.ok) {
    return { kind: 'invalid', issues: proposal.issues };
  }
  const review = resolveReview(tool, proposal.value, options);
  if (review === 'vscodeConfirmation') {
    options.ledger.record(tool.name, input);
  }
  return { kind: 'ready', summary: describe(tool, proposal.value), review };
}

/** Runs one tool invocation end to end. Called from `invoke()`. */
export async function runTool(
  tool: AnyToolDefinition, schema: JsonSchema, input: unknown, options: PipelineOptions, token: Cancellation,
): Promise<ToolOutcome> {
  const ctx = context(options, token);

  // 1. Untrusted input: structural validation.
  const schemaIssues = validateSchema(schema, input);
  if (schemaIssues.length > 0) {
    return { status: 'invalid', issues: schemaIssues };
  }
  throwIfCancelled(token);

  // 2a. Form tools: the human completes and approves the proposal.
  if (typeof tool.review !== 'function' && tool.review.kind === 'form') {
    const form = tool.review.form;
    const session: FormSession = {
      title: form.title,
      fields: form.fields as FormSession['fields'],
      initial: createFormState(form, input as Record<string, unknown>),
      validate: async (values) => {
        const structural = validateSchema(schema, values);
        if (structural.length > 0) {
          return structural;
        }
        // Show business problems for every field at once; a missing required field reports only "is required".
        const required = requiredIssues(form, values);
        const missing = new Set(required.map((i) => i.field));
        const proposal = await tool.propose(values, ctx);
        const business = proposal.ok ? [] : proposal.issues.filter((i) => !missing.has(i.field));
        return [...required, ...business];
      },
    };
    const review = await options.gateway.reviewForm(session, token);
    if (review.decision !== 'approved' || token.isCancellationRequested) {
      return { status: 'rejected', decision: review.decision === 'declined' ? 'declined' : 'cancelled' };
    }
    // Never trust the UI's own validation: re-validate exactly what will execute.
    const finalIssues = await session.validate(review.state.values);
    if (finalIssues.length > 0) {
      return { status: 'invalid', issues: finalIssues };
    }
    const proposal = await tool.propose(review.state.values, ctx);
    if (!proposal.ok) {
      return { status: 'invalid', issues: proposal.issues };
    }
    const approved = mint(proposal.value, { source: 'extension-form', fields: summarizeOrigins(review.state) });
    return executeApproved(tool, approved, ctx);
  }

  // 2b. Other tools: business validation, then the review the tool asks for.
  const proposal = await tool.propose(input, ctx);
  if (!proposal.ok) {
    return { status: 'invalid', issues: proposal.issues };
  }
  let review = resolveReview(tool, proposal.value, options);
  // Only trust VS Code's confirmation if prepareInvocation requested it for exactly this input.
  if (review === 'vscodeConfirmation' && !options.ledger.consume(tool.name, input)) {
    review = 'extensionConfirmation';
  }
  throwIfCancelled(token);

  let source: ApprovalSource;
  switch (review) {
    case 'none':
      source = 'not-required';
      break;
    case 'vscodeConfirmation':
      source = 'vscode-confirmation';
      break;
    case 'extensionConfirmation': {
      const decision = await options.gateway.confirm(describe(tool, proposal.value), token);
      if (decision !== 'approved' || token.isCancellationRequested) {
        return { status: 'rejected', decision: decision === 'declined' ? 'declined' : 'cancelled' };
      }
      source = 'extension-confirmation';
      break;
    }
  }
  return executeApproved(tool, mint(proposal.value, { source }), ctx);
}

async function executeApproved(tool: AnyToolDefinition, approved: Approved<unknown>, ctx: ToolContext): Promise<ToolOutcome> {
  if (!isApproved(approved)) {
    throw new Error('Refusing to execute a proposal that was not approved by the pipeline.');
  }
  if (ctx.token.isCancellationRequested) {
    return { status: 'rejected', decision: 'cancelled' };
  }
  const result = await tool.execute(approved, ctx);
  return { status: 'executed', result, approval: approved.approval };
}

function resolveReview(tool: AnyToolDefinition, proposal: unknown, options: PipelineOptions): 'none' | 'vscodeConfirmation' | 'extensionConfirmation' {
  const policy = typeof tool.review === 'function' ? tool.review(proposal) : tool.review;
  if (policy.kind === 'form') {
    throw new Error(`Tool '${tool.name}': form review must be declared statically.`);
  }
  if (policy.kind === 'none' && tool.category === 'mutate') {
    // Fail closed: a mutate tool can never run without review, even if its policy function says so.
    return 'extensionConfirmation';
  }
  if (policy.kind === 'vscodeConfirmation' && options.requireExtensionConfirmation) {
    return 'extensionConfirmation';
  }
  return policy.kind;
}

function describe(tool: AnyToolDefinition, proposal: unknown): OperationSummary {
  if (!tool.describe) {
    throw new Error(`Tool '${tool.name}' has no describe() implementation.`);
  }
  return tool.describe(proposal);
}

function context(options: PipelineOptions, token: Cancellation): ToolContext {
  return { workspace: options.workspace, token };
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
  }
  return value;
}
