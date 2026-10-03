import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isApproved, prepareTool, runTool, type Approved } from '../../src/core/pipeline';
import type { JsonSchema } from '../../src/core/schema';
import { defineTool, type ReviewPolicy } from '../../src/core/tool';
import { CancelledError, invalid, valid } from '../../src/core/types';
import { FakeGateway, FakeToken, pipelineOptions } from './fakes';

interface Input { name?: string; count?: number }
interface Proposal { name: string; count: number }

const schema: JsonSchema = {
  type: 'object',
  properties: { name: { type: 'string', maxLength: 20 }, count: { type: 'integer', minimum: 0 } },
  required: ['name'],
  additionalProperties: false,
};

/** A tool whose executor records every call, so tests can prove what did NOT execute. */
function spyTool(review: ReviewPolicy<Input> | ((p: Proposal) => { kind: 'none' | 'vscodeConfirmation' | 'extensionConfirmation' }), category: 'read' | 'mutate' = 'mutate') {
  const executed: Approved<Proposal>[] = [];
  const tool = defineTool<Input, Proposal>({
    name: 'test_spy',
    category,
    propose: (input) => (input.name === 'forbidden' ? invalid({ field: 'name', message: 'name is forbidden' }) : valid({ name: (input.name ?? '').trim(), count: input.count ?? 1 })),
    describe: (p) => ({ title: `Do ${p.name}`, changesState: category === 'mutate', resources: [], parameters: [] }),
    review,
    async execute(approved) {
      executed.push(approved);
      return { message: `did ${approved.proposal.name}` };
    },
  });
  return { tool, executed };
}

const formReview: ReviewPolicy<Input> = {
  kind: 'form',
  form: { title: 'Review', fields: [{ key: 'name', label: 'Name', kind: 'text', required: true }, { key: 'count', label: 'Count', kind: 'integer', defaultValue: 5 }] },
};

describe('pipeline: tool input', () => {
  it('rejects malformed input before review and never executes', async () => {
    const { tool, executed } = spyTool({ kind: 'extensionConfirmation' });
    const gateway = new FakeGateway('approved');
    for (const input of [null, 'text', {}, { name: 42 }, { name: 'ok', extra: true }, { name: 'x'.repeat(21) }, { name: 'ok', count: -1 }]) {
      const outcome = await runTool(tool, schema, input, pipelineOptions(gateway), new FakeToken());
      assert.equal(outcome.status, 'invalid', JSON.stringify(input));
    }
    assert.equal(gateway.confirmations.length, 0);
    assert.equal(executed.length, 0);
  });

  it('rejects input that fails business validation and never executes', async () => {
    const { tool, executed } = spyTool({ kind: 'extensionConfirmation' });
    const outcome = await runTool(tool, schema, { name: 'forbidden' }, pipelineOptions(new FakeGateway()), new FakeToken());
    assert.deepEqual(outcome, { status: 'invalid', issues: [{ field: 'name', message: 'name is forbidden' }] });
    assert.equal(executed.length, 0);
  });

  it('normalizes the proposal before execution', async () => {
    const { tool, executed } = spyTool({ kind: 'extensionConfirmation' });
    await runTool(tool, schema, { name: '  padded  ' }, pipelineOptions(new FakeGateway()), new FakeToken());
    assert.deepEqual(executed[0]?.proposal, { name: 'padded', count: 1 });
  });
});

describe('pipeline: approval', () => {
  it('runs read tools without review', async () => {
    const { tool, executed } = spyTool({ kind: 'none' }, 'read');
    const gateway = new FakeGateway('declined');
    const outcome = await runTool(tool, schema, { name: 'a' }, pipelineOptions(gateway), new FakeToken());
    assert.equal(outcome.status, 'executed');
    assert.equal(executed[0]?.approval.source, 'not-required');
    assert.equal(gateway.confirmations.length, 0);
  });

  it('executes after extension confirmation is approved', async () => {
    const { tool, executed } = spyTool({ kind: 'extensionConfirmation' });
    const gateway = new FakeGateway('approved');
    const outcome = await runTool(tool, schema, { name: 'a' }, pipelineOptions(gateway), new FakeToken());
    assert.equal(outcome.status, 'executed');
    assert.equal(gateway.confirmations[0]?.title, 'Do a');
    assert.equal(executed[0]?.approval.source, 'extension-confirmation');
  });

  for (const decision of ['declined', 'cancelled'] as const) {
    it(`a ${decision} proposal never reaches the executor`, async () => {
      const { tool, executed } = spyTool({ kind: 'extensionConfirmation' });
      const outcome = await runTool(tool, schema, { name: 'a' }, pipelineOptions(new FakeGateway(decision)), new FakeToken());
      assert.deepEqual(outcome, { status: 'rejected', decision });
      assert.equal(executed.length, 0);
    });
  }

  it('trusts VS Code confirmation only when prepareInvocation requested it for the same input', async () => {
    const { tool, executed } = spyTool({ kind: 'vscodeConfirmation' });
    const gateway = new FakeGateway('approved');
    const options = pipelineOptions(gateway);

    const prepared = await prepareTool(tool, schema, { name: 'a' }, options, new FakeToken());
    assert.equal(prepared.kind === 'ready' && prepared.review, 'vscodeConfirmation');
    await runTool(tool, schema, { name: 'a' }, options, new FakeToken());
    assert.equal(executed[0]?.approval.source, 'vscode-confirmation');
    assert.equal(gateway.confirmations.length, 0);

    // Same input again, but without a prepareInvocation: escalate to the extension's own confirmation.
    await runTool(tool, schema, { name: 'a' }, options, new FakeToken());
    assert.equal(executed[1]?.approval.source, 'extension-confirmation');
    assert.equal(gateway.confirmations.length, 1);
  });

  it('escalated confirmation that is declined never executes', async () => {
    const { tool, executed } = spyTool({ kind: 'vscodeConfirmation' });
    const outcome = await runTool(tool, schema, { name: 'a' }, pipelineOptions(new FakeGateway('declined')), new FakeToken());
    assert.equal(outcome.status, 'rejected');
    assert.equal(executed.length, 0);
  });

  it('requireExtensionConfirmation replaces VS Code confirmation with the extension modal', async () => {
    const { tool, executed } = spyTool({ kind: 'vscodeConfirmation' });
    const gateway = new FakeGateway('approved');
    const options = pipelineOptions(gateway, undefined, { requireExtensionConfirmation: true });
    const prepared = await prepareTool(tool, schema, { name: 'a' }, options, new FakeToken());
    assert.equal(prepared.kind === 'ready' && prepared.review, 'extensionConfirmation');
    await runTool(tool, schema, { name: 'a' }, options, new FakeToken());
    assert.equal(gateway.confirmations.length, 1);
    assert.equal(executed[0]?.approval.source, 'extension-confirmation');
  });

  it('fails closed when a mutate tool picks review "none" at runtime', async () => {
    const { tool, executed } = spyTool(() => ({ kind: 'none' }));
    const outcome = await runTool(tool, schema, { name: 'a' }, pipelineOptions(new FakeGateway('declined')), new FakeToken());
    assert.equal(outcome.status, 'rejected');
    assert.equal(executed.length, 0);
  });

  it('only pipeline-minted approvals are recognized, and they are frozen', async () => {
    const { tool, executed } = spyTool({ kind: 'extensionConfirmation' });
    await runTool(tool, schema, { name: 'a' }, pipelineOptions(new FakeGateway()), new FakeToken());
    const approved = executed[0];
    assert.ok(approved && isApproved(approved));
    assert.equal(isApproved({ proposal: { name: 'forged', count: 1 }, approval: { source: 'extension-confirmation', approvedAt: '' } }), false);
    assert.ok(Object.isFrozen(approved.proposal));
    assert.throws(() => {
      (approved.proposal as { name: string }).name = 'changed after approval';
    });
  });
});

describe('pipeline: cancellation', () => {
  it('does not review or execute when cancelled before review', async () => {
    const { tool, executed } = spyTool({ kind: 'extensionConfirmation' });
    const gateway = new FakeGateway('approved');
    const token = new FakeToken();
    token.isCancellationRequested = true;
    await assert.rejects(runTool(tool, schema, { name: 'a' }, pipelineOptions(gateway), token), CancelledError);
    assert.equal(gateway.confirmations.length, 0);
    assert.equal(executed.length, 0);
  });

  it('does not execute when cancelled while the human was reviewing', async () => {
    const { tool, executed } = spyTool({ kind: 'extensionConfirmation' });
    const token = new FakeToken();
    const gateway = new FakeGateway('approved', undefined, () => (token.isCancellationRequested = true));
    const outcome = await runTool(tool, schema, { name: 'a' }, pipelineOptions(gateway), token);
    assert.deepEqual(outcome, { status: 'rejected', decision: 'cancelled' });
    assert.equal(executed.length, 0);
  });

  it('does not execute a form that was approved after cancellation', async () => {
    const { tool, executed } = spyTool(formReview);
    const token = new FakeToken();
    const gateway = new FakeGateway('approved', { decision: 'approved' }, () => (token.isCancellationRequested = true));
    const outcome = await runTool(tool, schema, { name: 'a' }, pipelineOptions(gateway), token);
    assert.equal(outcome.status, 'rejected');
    assert.equal(executed.length, 0);
  });
});

describe('pipeline: form review', () => {
  it('pre-populates the form with AI values and defaults', async () => {
    const { tool } = spyTool(formReview);
    const gateway = new FakeGateway('approved', { decision: 'cancelled' });
    await runTool(tool, schema, { name: 'from-ai' }, pipelineOptions(gateway), new FakeToken());
    const initial = gateway.forms[0]?.initial;
    assert.deepEqual(initial?.values, { name: 'from-ai', count: 5 });
    assert.deepEqual(initial?.origins, { name: 'ai', count: 'default' });
  });

  it('executes the human-edited values, not the AI values, and reports which fields changed', async () => {
    const { tool, executed } = spyTool(formReview);
    const gateway = new FakeGateway('approved', { edits: { name: 'from-human' }, decision: 'approved' });
    const outcome = await runTool(tool, schema, { name: 'from-ai', count: 2 }, pipelineOptions(gateway), new FakeToken());
    assert.equal(outcome.status, 'executed');
    assert.deepEqual(executed[0]?.proposal, { name: 'from-human', count: 2 });
    assert.equal(executed[0]?.approval.source, 'extension-form');
    assert.deepEqual(executed[0]?.approval.fields?.user, ['name']);
    assert.deepEqual(executed[0]?.approval.fields?.ai, ['count']);
  });

  it('shows validation failures for AI values in the form instead of failing', async () => {
    const { tool } = spyTool(formReview);
    const gateway = new FakeGateway('approved', { decision: 'cancelled' });
    const outcome = await runTool(tool, schema, { name: 'forbidden' }, pipelineOptions(gateway), new FakeToken());
    assert.deepEqual(gateway.formIssuesSeen[0], ['name is forbidden']);
    assert.equal(outcome.status, 'rejected');
  });

  it('lets the human fix an invalid AI value and then executes', async () => {
    const { tool, executed } = spyTool(formReview);
    const gateway = new FakeGateway('approved', { edits: { name: 'fixed' }, decision: 'approved' });
    const outcome = await runTool(tool, schema, { name: 'forbidden' }, pipelineOptions(gateway), new FakeToken());
    assert.equal(outcome.status, 'executed');
    assert.equal(executed[0]?.proposal.name, 'fixed');
  });

  it('reports required fields the AI left empty', async () => {
    const { tool } = spyTool(formReview);
    const gateway = new FakeGateway('approved', { decision: 'cancelled' });
    // Form tools usually leave fields optional in the schema so the AI can send a partial proposal.
    const lenient: JsonSchema = { ...schema, required: [] };
    await runTool(tool, lenient, {}, pipelineOptions(gateway), new FakeToken());
    assert.deepEqual(gateway.formIssuesSeen[0], ['Name is required']);
  });

  for (const decision of ['declined', 'cancelled'] as const) {
    it(`a ${decision} form never reaches the executor`, async () => {
      const { tool, executed } = spyTool(formReview);
      const gateway = new FakeGateway('approved', { edits: { name: 'x' }, decision });
      const outcome = await runTool(tool, schema, { name: 'a' }, pipelineOptions(gateway), new FakeToken());
      assert.deepEqual(outcome, { status: 'rejected', decision });
      assert.equal(executed.length, 0);
    });
  }

  it('re-validates submitted values even if the UI let invalid values through', async () => {
    const { tool, executed } = spyTool(formReview);
    const gateway = new FakeGateway('approved', { edits: { name: 'forbidden' }, decision: 'approved', skipValidation: true });
    const outcome = await runTool(tool, schema, { name: 'a' }, pipelineOptions(gateway), new FakeToken());
    assert.equal(outcome.status, 'invalid');
    assert.equal(executed.length, 0);
  });

  it('prepareTool reports a form without calling propose side effects', async () => {
    const { tool } = spyTool(formReview);
    const prepared = await prepareTool(tool, schema, { name: 'a' }, pipelineOptions(new FakeGateway()), new FakeToken());
    assert.deepEqual(prepared, { kind: 'form', title: 'Review' });
  });
});

describe('defineTool rules', () => {
  const base = { propose: () => valid({}), describe: () => ({ title: 't', changesState: true, resources: [], parameters: [] }), execute: async () => ({ message: '' }) };

  it('refuses a mutate tool without review', () => {
    assert.throws(() => defineTool({ ...base, name: 'x_y', category: 'mutate', review: { kind: 'none' } }), /must declare a human review policy/);
  });

  it('refuses reserved or malformed names', () => {
    for (const name of ['copilot_x', 'vscode_x', 'has space', '']) {
      assert.throws(() => defineTool({ ...base, name, category: 'read', review: { kind: 'none' } }));
    }
  });

  it('requires describe() unless the review is a form', () => {
    assert.throws(() => defineTool({ name: 'x_y', category: 'read', review: { kind: 'none' }, propose: () => valid({}), execute: async () => ({ message: '' }) }), /describe/);
  });
});
