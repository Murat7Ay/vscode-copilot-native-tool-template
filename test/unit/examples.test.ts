import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createTicketTool, exampleCreateTicketSchema, type TicketApi, type TicketProposal } from '../../examples/tools/createTicket';
import { findUnsupportedKeywords, type JsonSchema } from '../../src/core/schema';
import { prepareTool, runTool } from '../../src/core/pipeline';
import { FakeGateway, FakeToken, pipelineOptions } from './fakes';

/** Fake internal API: records every consequential call. */
class FakeTicketApi implements TicketApi {
  readonly created: TicketProposal[] = [];
  async componentExists(component: string): Promise<boolean> {
    return ['billing', 'search'].includes(component);
  }
  async createTicket(ticket: TicketProposal): Promise<{ id: string }> {
    this.created.push(ticket);
    return { id: `T-${this.created.length}` };
  }
}

const schema = exampleCreateTicketSchema as unknown as JsonSchema;

describe('example: tool calling an internal API through a port', () => {
  it('uses only supported schema keywords', () => {
    assert.deepEqual(findUnsupportedKeywords(schema), []);
  });

  it('calls the API after approval', async () => {
    const api = new FakeTicketApi();
    const tool = createTicketTool(api);
    const options = pipelineOptions(new FakeGateway('approved'));
    const input = { title: 'Invoice totals wrong', component: ' Billing ' };
    await prepareTool(tool, schema, input, options, new FakeToken());
    const outcome = await runTool(tool, schema, input, options, new FakeToken());
    assert.equal(outcome.status, 'executed');
    assert.deepEqual(api.created, [{ title: 'Invoice totals wrong', component: 'billing', priority: 'normal', description: '' }]);
  });

  it('a declined ticket never reaches the API', async () => {
    const api = new FakeTicketApi();
    const outcome = await runTool(createTicketTool(api), schema, { title: 'Invoice totals wrong', component: 'billing' }, pipelineOptions(new FakeGateway('declined')), new FakeToken());
    assert.equal(outcome.status, 'rejected');
    assert.equal(api.created.length, 0);
  });

  it('critical tickets require the extension confirmation, whatever VS Code auto-approves', async () => {
    const api = new FakeTicketApi();
    const gateway = new FakeGateway('declined');
    const options = pipelineOptions(gateway);
    const input = { title: 'Checkout is down', component: 'search', priority: 'critical' };
    const prepared = await prepareTool(createTicketTool(api), schema, input, options, new FakeToken());
    assert.equal(prepared.kind === 'ready' && prepared.review, 'extensionConfirmation');
    await runTool(createTicketTool(api), schema, input, options, new FakeToken());
    assert.equal(gateway.confirmations[0]?.warnings?.[0], 'Critical tickets page the on-call engineer.');
    assert.equal(api.created.length, 0);
  });

  it('unknown components are rejected before any review', async () => {
    const api = new FakeTicketApi();
    const gateway = new FakeGateway('approved');
    const outcome = await runTool(createTicketTool(api), schema, { title: 'Something broke', component: 'nope' }, pipelineOptions(gateway), new FakeToken());
    assert.equal(outcome.status, 'invalid');
    assert.equal(gateway.confirmations.length, 0);
    assert.equal(api.created.length, 0);
  });
});
