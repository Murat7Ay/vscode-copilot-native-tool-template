import * as vscode from 'vscode';

/**
 * Runtime feature detection.
 *
 * `engines.vscode` already stops VS Code from installing or activating this extension on
 * older versions, but VS Code-compatible editors and forks may expose the same version number
 * without implementing every API. Detect, log and degrade instead of throwing on activation.
 *
 * Proposed APIs (e.g. `toolInvocationApproveCombination` for per-argument approval) belong
 * here too, behind a function like `supportsApproveCombination()`, so tools never touch them
 * directly. The template deliberately uses none: proposed APIs only work in VS Code Insiders
 * with explicit opt-in and cannot be published to the Marketplace.
 */
export function supportsLanguageModelTools(): boolean {
  return typeof (vscode.lm as Partial<typeof vscode.lm> | undefined)?.registerTool === 'function';
}
