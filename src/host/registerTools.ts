import * as vscode from 'vscode';
import { ConfirmationLedger } from '../core/ledger';
import { prepareTool, runTool, type PipelineOptions, type ReviewGateway, type ToolOutcome } from '../core/pipeline';
import type { JsonSchema } from '../core/schema';
import { renderSummaryMarkdown } from '../core/summary';
import type { AnyToolDefinition } from '../core/tool';
import { CancelledError } from '../core/types';
import type { WorkspacePort } from '../core/workspace';

/**
 * Adapts template tool definitions to `vscode.lm.registerTool`. This file and the other files
 * in `src/host` are the compatibility boundary: when the VS Code tool API changes, derived
 * extensions update this folder (or the template version) and leave their tools untouched.
 */

export interface ToolHost {
  readonly workspace: WorkspacePort;
  readonly gateway: ReviewGateway;
  readonly log: vscode.LogOutputChannel;
  /** Read on every invocation so setting changes apply immediately. */
  readonly requireExtensionConfirmation: () => boolean;
}

interface ManifestTool {
  name: string;
  displayName?: string;
  inputSchema?: JsonSchema;
}

/** Registers every tool, using the `inputSchema` declared in package.json as the single source of truth. */
export function registerTools(context: vscode.ExtensionContext, tools: readonly AnyToolDefinition[], host: ToolHost): void {
  const declared = new Map<string, ManifestTool>();
  const manifestTools = (context.extension.packageJSON as { contributes?: { languageModelTools?: ManifestTool[] } }).contributes?.languageModelTools ?? [];
  for (const entry of manifestTools) {
    declared.set(entry.name, entry);
  }

  const ledger = new ConfirmationLedger();
  for (const tool of tools) {
    const manifest = declared.get(tool.name);
    if (!manifest) {
      throw new Error(`Tool '${tool.name}' is not declared in package.json contributes.languageModelTools.`);
    }
    const schema: JsonSchema = manifest.inputSchema ?? { type: 'object', properties: {}, additionalProperties: false };
    context.subscriptions.push(vscode.lm.registerTool(tool.name, new LanguageModelToolAdapter(tool, schema, manifest.displayName ?? tool.name, ledger, host)));
    host.log.info(`Registered tool ${tool.name} (${tool.category})`);
  }
}

class LanguageModelToolAdapter implements vscode.LanguageModelTool<unknown> {
  constructor(
    private readonly tool: AnyToolDefinition,
    private readonly schema: JsonSchema,
    private readonly displayName: string,
    private readonly ledger: ConfirmationLedger,
    private readonly host: ToolHost,
  ) {}

  private options(): PipelineOptions {
    return {
      workspace: this.host.workspace,
      gateway: this.host.gateway,
      ledger: this.ledger,
      requireExtensionConfirmation: this.host.requireExtensionConfirmation(),
    };
  }

  /** Must be free of side effects, and may not be followed by `invoke` (e.g. if the user cancels). */
  async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<unknown>, token: vscode.CancellationToken,
  ): Promise<vscode.PreparedToolInvocation> {
    const preparation = await prepareTool(this.tool, this.schema, options.input, this.options(), token);
    switch (preparation.kind) {
      case 'invalid':
        // invoke() will report the issues to the model; nothing can execute.
        return { invocationMessage: `Checking ${this.displayName} input` };
      case 'form':
        return { invocationMessage: `Waiting for your review: ${preparation.title}` };
      case 'ready': {
        const { summary, review } = preparation;
        if (review === 'vscodeConfirmation') {
          const message = new vscode.MarkdownString(renderSummaryMarkdown(summary));
          message.supportThemeIcons = true; // isTrusted stays false: no command links from untrusted text.
          return { invocationMessage: summary.title, confirmationMessages: { title: summary.title, message } };
        }
        if (review === 'extensionConfirmation') {
          return { invocationMessage: `Waiting for your confirmation: ${summary.title}` };
        }
        return { invocationMessage: summary.title };
      }
    }
  }

  async invoke(options: vscode.LanguageModelToolInvocationOptions<unknown>, token: vscode.CancellationToken): Promise<vscode.LanguageModelToolResult> {
    let outcome: ToolOutcome;
    try {
      outcome = await runTool(this.tool, this.schema, options.input, this.options(), token);
    } catch (error) {
      if (error instanceof CancelledError) {
        outcome = { status: 'rejected', decision: 'cancelled' };
      } else {
        this.host.log.error(`${this.tool.name}: failed: ${String(error)}`);
        throw new Error(`${this.displayName} failed: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
      }
    }
    // Audit line: outcome and approval source only, never input values.
    this.host.log.info(`${this.tool.name}: ${outcome.status}${outcome.status === 'executed' ? ` (approval: ${outcome.approval.source})` : outcome.status === 'rejected' ? ` (${outcome.decision})` : ''}`);
    return toToolResult(this.displayName, outcome);
  }
}

/** Converts a pipeline outcome into what the language model sees. Exported for tests. */
export function toToolResult(displayName: string, outcome: ToolOutcome): vscode.LanguageModelToolResult {
  switch (outcome.status) {
    case 'invalid':
      // Throwing marks the call as failed; the message is shown to the model so it can correct the input.
      throw new Error(
        `Invalid input for ${displayName}:\n${outcome.issues.map((i) => `- ${i.message}`).join('\n')}\nCorrect the input and call the tool again, or ask the user for the missing information.`,
      );
    case 'rejected':
      return text(`The user ${outcome.decision === 'declined' ? 'declined' : 'cancelled'} the ${displayName} operation. Nothing was executed. Do not retry unless the user asks.`);
    case 'executed': {
      const payload = { ...outcome.result.data, approval: outcome.approval.source };
      return text(`${outcome.result.message}\n\n${JSON.stringify(payload, null, 2)}`);
    }
  }
}

function text(value: string): vscode.LanguageModelToolResult {
  return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(value)]);
}
