import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import { prepareTool, runTool } from '../../src/core/pipeline';
import type { JsonSchema } from '../../src/core/schema';
import { createNoteTool } from '../../src/tools/createNote';
import { inspectSelectionTool } from '../../src/tools/inspectSelection';
import { prepareEditorConfigTool } from '../../src/tools/prepareEditorConfig';
import { projectOperationTool } from '../../src/tools/projectOperation';
import { FakeGateway, FakeToken, FakeWorkspace, pipelineOptions } from './fakes';

/** Tests use the real schemas from package.json, exactly as the extension does at runtime. */
const manifest = JSON.parse(readFileSync(resolve(__dirname, '../../../package.json'), 'utf8')) as {
  contributes: { languageModelTools: { name: string; inputSchema: JsonSchema }[] };
};
const schemaOf = (name: string): JsonSchema => {
  const entry = manifest.contributes.languageModelTools.find((t) => t.name === name);
  assert.ok(entry, `no manifest entry for ${name}`);
  return entry.inputSchema;
};

describe('inspect_selection (read)', () => {
  const schema = schemaOf(inspectSelectionTool.name);

  it('returns the selection, truncated, without any review', async () => {
    const workspace = new FakeWorkspace();
    workspace.editor = { path: 'src/a.ts', languageId: 'typescript', selection: { startLine: 0, startCharacter: 0, endLine: 1, endCharacter: 3 }, selectedText: 'abcdef' };
    const gateway = new FakeGateway('declined');
    const outcome = await runTool(inspectSelectionTool, schema, { maxCharacters: 3 }, pipelineOptions(gateway, workspace), new FakeToken());
    assert.equal(outcome.status, 'executed');
    assert.equal(outcome.status === 'executed' && outcome.result.data?.selectedText, 'ab…');
    assert.equal(gateway.confirmations.length, 0);
  });

  it('handles a missing editor', async () => {
    const outcome = await runTool(inspectSelectionTool, schema, {}, pipelineOptions(new FakeGateway()), new FakeToken());
    assert.match(outcome.status === 'executed' ? outcome.result.message : '', /no active text editor/);
  });

  it('rejects malformed input', async () => {
    const outcome = await runTool(inspectSelectionTool, schema, { maxCharacters: 0 }, pipelineOptions(new FakeGateway()), new FakeToken());
    assert.equal(outcome.status, 'invalid');
  });
});

describe('prepare_editorconfig (prepare)', () => {
  const schema = schemaOf(prepareEditorConfigTool.name);

  it('returns a proposal with defaults, without review and without writing', async () => {
    const workspace = new FakeWorkspace();
    workspace.files.set('.editorconfig', 'old');
    const gateway = new FakeGateway('declined');
    const outcome = await runTool(prepareEditorConfigTool, schema, { indentStyle: 'tab' }, pipelineOptions(gateway, workspace), new FakeToken());
    assert.equal(outcome.status, 'executed');
    if (outcome.status === 'executed') {
      assert.equal(outcome.approval.source, 'not-required');
      assert.match(String(outcome.result.data?.content), /indent_style = tab\nindent_size = 4\nend_of_line = lf/);
      assert.equal(outcome.result.data?.existingFile, true);
    }
    assert.equal(gateway.confirmations.length, 0);
    assert.equal(workspace.files.get('.editorconfig'), 'old', 'prepare tools never write');
  });

  it('rejects malformed input', async () => {
    for (const input of [{}, { indentStyle: 'both' }, { indentStyle: 'space', indentSize: 99 }]) {
      const outcome = await runTool(prepareEditorConfigTool, schema, input, pipelineOptions(new FakeGateway()), new FakeToken());
      assert.equal(outcome.status, 'invalid', JSON.stringify(input));
    }
  });
});

describe('create_note (simple operation)', () => {
  const schema = schemaOf(createNoteTool.name);

  it('asks VS Code to confirm a new note, with a specific summary', async () => {
    const prepared = await prepareTool(createNoteTool, schema, { title: 'Release Checklist', body: 'x' }, pipelineOptions(new FakeGateway()), new FakeToken());
    assert.equal(prepared.kind, 'ready');
    if (prepared.kind === 'ready') {
      assert.equal(prepared.review, 'vscodeConfirmation');
      assert.equal(prepared.summary.title, 'Create note "Release Checklist"');
      assert.deepEqual(prepared.summary.resources, [{ path: 'notes/release-checklist.md', effect: 'create' }]);
      assert.equal(prepared.summary.changesState, true);
    }
  });

  it('writes the note after the VS Code confirmation', async () => {
    const workspace = new FakeWorkspace();
    const options = pipelineOptions(new FakeGateway(), workspace);
    const input = { title: 'Release Checklist', body: '- item\n' };
    await prepareTool(createNoteTool, schema, input, options, new FakeToken());
    const outcome = await runTool(createNoteTool, schema, input, options, new FakeToken());
    assert.equal(outcome.status, 'executed');
    assert.equal(workspace.files.get('notes/release-checklist.md'), '# Release Checklist\n\n- item\n');
  });

  it('refuses to replace an existing note unless overwrite is requested', async () => {
    const workspace = new FakeWorkspace();
    workspace.files.set('notes/a.md', 'old');
    const outcome = await runTool(createNoteTool, schema, { title: 'A', body: 'new' }, pipelineOptions(new FakeGateway(), workspace), new FakeToken());
    assert.equal(outcome.status, 'invalid');
    assert.equal(workspace.files.get('notes/a.md'), 'old');
  });

  it('requires the extension confirmation to overwrite, and a decline leaves the file untouched', async () => {
    const workspace = new FakeWorkspace();
    workspace.files.set('notes/a.md', 'old');
    const gateway = new FakeGateway('declined');
    const options = pipelineOptions(gateway, workspace);
    const input = { title: 'A', body: 'new', overwrite: true };
    const prepared = await prepareTool(createNoteTool, schema, input, options, new FakeToken());
    assert.equal(prepared.kind === 'ready' && prepared.review, 'extensionConfirmation');
    const outcome = await runTool(createNoteTool, schema, input, options, new FakeToken());
    assert.equal(outcome.status, 'rejected');
    assert.equal(gateway.confirmations[0]?.warnings?.[0], 'The existing file will be replaced.');
    assert.equal(workspace.files.get('notes/a.md'), 'old');
  });

  it('fails without a workspace folder', async () => {
    const workspace = new FakeWorkspace();
    workspace.isOpen = false;
    const outcome = await runTool(createNoteTool, schema, { title: 'A', body: '' }, pipelineOptions(new FakeGateway(), workspace), new FakeToken());
    assert.equal(outcome.status, 'invalid');
  });
});

describe('project_operation (form)', () => {
  const schema = schemaOf(projectOperationTool.name);
  const workspaceWithTarget = () => {
    const w = new FakeWorkspace();
    w.dirs.add('src/billing');
    return w;
  };
  const aiInput = { name: 'cleanupBilling', description: 'Remove dead code', target: 'src\\billing', mode: 'record', tags: ['Backend', 'backend', ' cleanup '] };

  it('opens the form pre-filled with AI values and defaults, with no issues', async () => {
    const gateway = new FakeGateway('approved', { decision: 'cancelled' });
    await runTool(projectOperationTool, schema, aiInput, pipelineOptions(gateway, workspaceWithTarget()), new FakeToken());
    const form = gateway.forms[0];
    assert.equal(form?.initial.origins.name, 'ai');
    assert.equal(form?.initial.origins.priority, 'default');
    assert.equal(form?.initial.values.timeoutSeconds, 60);
    assert.deepEqual(gateway.formIssuesSeen[0], []);
  });

  it('shows business validation problems in the form', async () => {
    const gateway = new FakeGateway('approved', { decision: 'cancelled' });
    await runTool(projectOperationTool, schema, { name: '1bad', target: 'missing/folder', tags: ['ok', 'bad tag'] }, pipelineOptions(gateway, workspaceWithTarget()), new FakeToken());
    const issues = gateway.formIssuesSeen[0] ?? [];
    assert.ok(issues.some((m) => m.startsWith('Name must start with a letter')));
    assert.ok(issues.includes('Description is required'));
    assert.ok(issues.includes("Target 'missing/folder' does not exist in the workspace"));
    assert.ok(issues.includes("Tag 'bad tag' may only contain lowercase letters, digits and '-'"));
  });

  it('records the human-approved, normalized and enriched operation', async () => {
    const workspace = workspaceWithTarget();
    const gateway = new FakeGateway('approved', { edits: { priority: 'high' }, decision: 'approved' });
    const outcome = await runTool(projectOperationTool, schema, aiInput, pipelineOptions(gateway, workspace), new FakeToken());
    assert.equal(outcome.status, 'executed');
    const record = JSON.parse(workspace.files.get('.project-operations/cleanupBilling.json') ?? '{}');
    assert.deepEqual(record.operation, {
      name: 'cleanupBilling', description: 'Remove dead code', target: 'src/billing', targetKind: 'directory',
      mode: 'record', priority: 'high', tags: ['backend', 'cleanup'], timeoutSeconds: 60,
    });
    assert.equal(record.approval.source, 'extension-form');
    assert.deepEqual(record.approval.fields.user, ['priority']);
    assert.deepEqual(outcome.status === 'executed' && outcome.result.data?.changedByUser, ['priority']);
  });

  it('preview mode writes nothing', async () => {
    const workspace = workspaceWithTarget();
    const gateway = new FakeGateway('approved', { edits: { mode: 'preview' }, decision: 'approved' });
    const outcome = await runTool(projectOperationTool, schema, aiInput, pipelineOptions(gateway, workspace), new FakeToken());
    assert.equal(outcome.status, 'executed');
    assert.equal(workspace.files.size, 0);
  });

  it('a cancelled form writes nothing', async () => {
    const workspace = workspaceWithTarget();
    const outcome = await runTool(projectOperationTool, schema, aiInput, pipelineOptions(new FakeGateway('approved', { decision: 'cancelled' }), workspace), new FakeToken());
    assert.equal(outcome.status, 'rejected');
    assert.equal(workspace.files.size, 0);
  });

  it('rejects structurally malformed AI input before opening the form', async () => {
    const gateway = new FakeGateway();
    const outcome = await runTool(projectOperationTool, schema, { mode: 'delete-everything' }, pipelineOptions(gateway, workspaceWithTarget()), new FakeToken());
    assert.equal(outcome.status, 'invalid');
    assert.equal(gateway.forms.length, 0);
  });
});
