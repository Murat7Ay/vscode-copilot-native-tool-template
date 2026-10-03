import * as vscode from 'vscode';
import type { ReviewGateway } from '../core/pipeline';
import { renderSummaryPlain } from '../core/summary';
import { showQuickPickForm } from './quickPickForm';

const APPROVE = 'Approve';

/** Extension-owned review UI. Shown inside `invoke()`, so VS Code tool auto-approval cannot skip it. */
export function createVscodeReviewGateway(): ReviewGateway {
  return {
    async confirm(summary) {
      // Modal: the human must click Approve. Closing the dialog declines.
      const choice = await vscode.window.showWarningMessage(
        summary.title,
        { modal: true, detail: renderSummaryPlain(summary) },
        APPROVE,
      );
      return choice === APPROVE ? 'approved' : 'declined';
    },
    reviewForm: (session, token) => showQuickPickForm(session, token as vscode.CancellationToken),
  };
}
