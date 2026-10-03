import { editField, type FormState } from '../../src/core/form';
import { ConfirmationLedger } from '../../src/core/ledger';
import type { FormReview, FormSession, PipelineOptions, ReviewDecision, ReviewGateway } from '../../src/core/pipeline';
import type { Cancellation, OperationSummary } from '../../src/core/types';
import type { EditorSnapshot, WorkspacePort } from '../../src/core/workspace';

/** In-memory workspace. */
export class FakeWorkspace implements WorkspacePort {
  readonly files = new Map<string, string>();
  readonly dirs = new Set<string>();
  editor: EditorSnapshot | undefined;
  isOpen = true;

  async stat(path: string): Promise<'file' | 'directory' | undefined> {
    return this.files.has(path) ? 'file' : this.dirs.has(path) ? 'directory' : undefined;
  }

  async writeTextFile(path: string, content: string, options: { overwrite: boolean }): Promise<void> {
    if (!options.overwrite && this.files.has(path)) {
      throw new Error(`${path} already exists.`);
    }
    this.files.set(path, content);
  }

  activeEditor(): EditorSnapshot | undefined {
    return this.editor;
  }
}

/** Scripted human. Records what it was shown. */
export class FakeGateway implements ReviewGateway {
  confirmations: OperationSummary[] = [];
  forms: FormSession[] = [];
  formIssuesSeen: string[][] = [];

  constructor(
    private readonly confirmDecision: ReviewDecision = 'approved',
    /** Edits the human makes in the form, then the decision. */
    private readonly formScript: { edits?: Record<string, unknown>; decision: ReviewDecision; skipValidation?: boolean } = { decision: 'approved' },
    private readonly onReview?: () => void,
  ) {}

  async confirm(summary: OperationSummary): Promise<ReviewDecision> {
    this.confirmations.push(summary);
    this.onReview?.();
    return this.confirmDecision;
  }

  async reviewForm(session: FormSession): Promise<FormReview> {
    this.forms.push(session);
    this.formIssuesSeen.push((await session.validate(session.initial.values)).map((i) => i.message));
    let state: FormState = session.initial;
    for (const [key, value] of Object.entries(this.formScript.edits ?? {})) {
      state = editField(state, key, value);
    }
    this.onReview?.();
    if (this.formScript.decision !== 'approved') {
      return { decision: this.formScript.decision };
    }
    // A well-behaved UI refuses to submit with issues; `skipValidation` simulates a buggy UI.
    if (!this.formScript.skipValidation && (await session.validate(state.values)).length > 0) {
      return { decision: 'cancelled' };
    }
    return { decision: 'approved', state };
  }
}

export class FakeToken implements Cancellation {
  isCancellationRequested = false;
}

export function pipelineOptions(gateway: ReviewGateway, workspace: WorkspacePort = new FakeWorkspace(), extra: Partial<PipelineOptions> = {}): PipelineOptions {
  return { workspace, gateway, ledger: new ConfirmationLedger(), requireExtensionConfirmation: false, ...extra };
}
