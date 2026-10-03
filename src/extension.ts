import * as vscode from 'vscode';
import { supportsLanguageModelTools } from './host/capabilities';
import { registerTools } from './host/registerTools';
import { createVscodeReviewGateway } from './host/reviewGateway';
import { createVscodeWorkspace } from './host/vscodeWorkspace';
import { tools } from './tools';

/** Configuration section declared in package.json `contributes.configuration`. Rename together. */
export const SETTINGS_SECTION = 'nativeToolTemplate';

/**
 * Activated by the implicit `onLanguageModelTool:<name>` events VS Code generates from
 * `contributes.languageModelTools`, i.e. the first time one of the tools is invoked.
 */
export function activate(context: vscode.ExtensionContext): void {
  const log = vscode.window.createOutputChannel('Native Tool Template', { log: true });
  context.subscriptions.push(log);

  if (!supportsLanguageModelTools()) {
    log.warn('This editor does not support vscode.lm.registerTool; no tools were registered.');
    return;
  }

  registerTools(context, tools, {
    workspace: createVscodeWorkspace(),
    gateway: createVscodeReviewGateway(),
    log,
    requireExtensionConfirmation: () =>
      vscode.workspace.getConfiguration(SETTINGS_SECTION).get<boolean>('approval.requireExtensionConfirmation', false),
  });
}

export function deactivate(): void {
  // Registrations are disposed through context.subscriptions.
}
