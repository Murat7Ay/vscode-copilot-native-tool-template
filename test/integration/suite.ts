import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as vscode from 'vscode';

/**
 * Runs inside a real VS Code extension host (see runTests.ts). Calls tools through
 * `vscode.lm.invokeTool`, the same tool service agent mode uses, but without a chat session.
 * Copilot is not involved.
 */

const EXTENSION_ID = 'example.native-tool-template';
const pkg = JSON.parse(readFileSync(resolve(__dirname, '../../../package.json'), 'utf8')) as {
  contributes: { languageModelTools: { name: string; modelDescription: string; inputSchema: object; tags: string[] }[] };
};

const tests: [string, () => Promise<void>][] = [];
const test = (name: string, fn: () => Promise<void>) => tests.push([name, fn]);

const root = () => vscode.workspace.workspaceFolders![0]!.uri;
const exists = (relative: string) => vscode.workspace.fs.stat(vscode.Uri.joinPath(root(), relative)).then(() => true, () => false);
const textOf = (result: vscode.LanguageModelToolResult) =>
  result.content.filter((p): p is vscode.LanguageModelTextPart => p instanceof vscode.LanguageModelTextPart).map((p) => p.value).join('\n');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const firstLine = (text: string) => text.split('\n')[0];

function invoke(name: string, input: object, token?: vscode.CancellationToken): Thenable<vscode.LanguageModelToolResult> {
  return vscode.lm.invokeTool(name, { input, toolInvocationToken: undefined }, token);
}

async function withTimeout<T>(promise: Thenable<T>, ms: number, what: string): Promise<T> {
  return Promise.race([promise, sleep(ms).then(() => { throw new Error(`Timed out after ${ms}ms: ${what}`); })]);
}

test('registers every manifest tool with the declared schema, before activation', async () => {
  // Tools are listed from the manifest; the extension itself is activated lazily on first invocation.
  assert.equal(vscode.extensions.getExtension(EXTENSION_ID)?.isActive, false);
  for (const declared of pkg.contributes.languageModelTools) {
    const info = vscode.lm.tools.find((t) => t.name === declared.name);
    assert.ok(info, `${declared.name} missing from vscode.lm.tools`);
    assert.equal(info.description, declared.modelDescription);
    assert.deepEqual(info.inputSchema, declared.inputSchema);
    assert.deepEqual([...info.tags], declared.tags);
  }
});

test('activates on first tool invocation and runs a read-only tool without confirmation', async () => {
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(root(), 'src/billing/Invoice.java'));
  const editor = await vscode.window.showTextDocument(doc);
  editor.selection = new vscode.Selection(1, 2, 1, 28);

  // A hang here would mean VS Code showed a confirmation for a tool that requested none.
  const result = await withTimeout(invoke('template_inspect_selection', { maxCharacters: 100 }), 10000, 'read-only tool');
  const text = textOf(result);
  assert.match(text, /src\/billing\/Invoice\.java/);
  assert.match(text, /int total\(\) \{ return 42; \}/);
  assert.equal(vscode.extensions.getExtension(EXTENSION_ID)?.isActive, true);
});

test('prepare tool returns a proposal without a prompt and writes nothing', async () => {
  const text = textOf(await withTimeout(invoke('template_prepare_editorconfig', { indentStyle: 'space', indentSize: 4 }), 10000, 'prepare tool'));
  assert.match(text, /Nothing was written/);
  assert.match(text, /indent_size = 4/);
  assert.equal(await exists('.editorconfig'), false);
});

test('rejects malformed input and executes nothing', async () => {
  await assert.rejects(Promise.resolve(invoke('template_create_note', { title: 42 })));
  await assert.rejects(Promise.resolve(invoke('template_create_note', { title: 'x', body: 'y', shell: 'rm -rf /' })));
  assert.equal(await exists('notes'), false);
});

test('form tool: dismissing the form (Esc) executes nothing', async () => {
  const pending = invoke('template_project_operation', { name: 'cleanupBilling', description: 'd', target: 'src/billing', mode: 'record' });
  await sleep(1500);
  await vscode.commands.executeCommand('workbench.action.closeQuickOpen');
  const text = textOf(await withTimeout(pending, 10000, 'form dismissal'));
  assert.match(text, /cancelled the Project Operation operation\. Nothing was executed/);
  assert.equal(await exists('.project-operations'), false);
});

test('form tool: cancelling the invocation token closes the form and executes nothing', async () => {
  const cts = new vscode.CancellationTokenSource();
  const pending = Promise.resolve(invoke('template_project_operation', { name: 'cancelMe', description: 'd', target: 'src/billing', mode: 'record' }, cts.token));
  await sleep(1500);
  cts.cancel();
  // VS Code may resolve with our "cancelled" result or reject with a CancellationError; either way nothing runs.
  await withTimeout(pending.then(textOf, (e: unknown) => String(e)), 10000, 'token cancellation');
  await sleep(500);
  assert.equal(await exists('.project-operations/cancelMe.json'), false);
});

test('form tool: submitting the pre-filled form through the real QuickPick executes the approved values', async () => {
  const pending = invoke('template_project_operation', { name: 'submitted', description: 'Pre-filled by AI', target: 'src\\billing', mode: 'record', tags: ['Backend'] });
  await sleep(1500);
  // The first field is active; move past the 7 fields to "Submit" and accept it.
  for (let i = 0; i < 7; i++) {
    await vscode.commands.executeCommand('workbench.action.quickOpenSelectNext');
  }
  await vscode.commands.executeCommand('workbench.action.acceptSelectedQuickOpenItem');
  const text = textOf(await withTimeout(pending, 10000, 'form submission'));
  assert.match(text, /Recorded operation 'submitted'/);
  assert.match(text, /"approval": "extension-form"/);
  const record = JSON.parse(new TextDecoder().decode(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(root(), '.project-operations/submitted.json'))));
  assert.equal(record.operation.target, 'src/billing');
  assert.equal(record.operation.targetKind, 'directory');
  assert.deepEqual(record.operation.tags, ['backend']);
  assert.deepEqual(record.approval.fields.ai.sort(), ['description', 'mode', 'name', 'tags', 'target']);
});

/*
 * VS Code's DialogService auto-confirms `confirm()` dialogs when running extension tests
 * (src/vs/workbench/services/dialogs/common/dialogService.ts, skipDialogs), and refuses
 * `prompt()` dialogs, which back modal showWarningMessage. So in this harness the VS Code tool
 * confirmation is auto-approved while the extension's own modal can never be approved. That
 * is exactly the difference the template is built around, observed in a real VS Code.
 */
test('simple tool: VS Code confirmation path (auto-approved by the test harness) executes', async () => {
  const text = textOf(await withTimeout(invoke('template_create_note', { title: 'Release Checklist', body: '- item' }), 10000, 'create note'));
  assert.match(text, /Created notes\/release-checklist\.md/);
  // Proves prepareInvocation recorded the confirmation and invoke matched the same input across the extension-host boundary.
  assert.match(text, /"approval": "vscode-confirmation"/);
  assert.equal(new TextDecoder().decode(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(root(), 'notes/release-checklist.md'))), '# Release Checklist\n\n- item\n');
});

test('simple tool: overwrite needs the extension modal, which VS Code auto-approval cannot satisfy', async () => {
  const outcome = await withTimeout(
    Promise.resolve(invoke('template_create_note', { title: 'Release Checklist', body: 'REPLACED', overwrite: true })).then(textOf, (e: unknown) => `error: ${String(e)}`),
    10000, 'overwrite note');
  console.log(`    overwrite outcome: ${firstLine(outcome)}`);
  assert.match(outcome, /declined|refused to show dialog/);
  const content = new TextDecoder().decode(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(root(), 'notes/release-checklist.md')));
  assert.equal(content, '# Release Checklist\n\n- item\n', 'file must be unchanged');
});

test('setting requireExtensionConfirmation turns VS Code confirmation into the extension modal', async () => {
  const config = vscode.workspace.getConfiguration('nativeToolTemplate');
  await config.update('approval.requireExtensionConfirmation', true, vscode.ConfigurationTarget.Global);
  try {
    const outcome = await withTimeout(Promise.resolve(invoke('template_create_note', { title: 'Strict Mode', body: 'x' })).then(textOf, String), 10000, 'strict create');
    console.log(`    strict outcome: ${firstLine(outcome)}`);
    assert.match(outcome, /declined|refused to show dialog/);
    assert.equal(await exists('notes/strict-mode.md'), false);
  } finally {
    await config.update('approval.requireExtensionConfirmation', undefined, vscode.ConfigurationTarget.Global);
  }
});

export async function run(): Promise<void> {
  const failures: string[] = [];
  for (const [name, fn] of tests) {
    try {
      await fn();
      console.log(`  ✔ ${name}`);
    } catch (error) {
      failures.push(name);
      console.log(`  ✖ ${name}\n    ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
    }
  }
  console.log(`\n${tests.length - failures.length} passed, ${failures.length} failed (VS Code ${vscode.version})`);
  if (failures.length > 0) {
    throw new Error(`${failures.length} integration test(s) failed`);
  }
}
