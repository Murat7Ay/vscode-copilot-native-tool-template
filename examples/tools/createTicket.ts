import { defineTool } from '../../src/core/tool';
import { invalid, valid } from '../../src/core/types';

/**
 * EXAMPLE (not registered): a tool that calls an internal system through a PORT.
 *
 * The tool depends on the `TicketApi` interface, not on HTTP, `vscode` or credentials. The
 * real implementation would live in `src/host/` (using fetch plus a token from VS Code's
 * SecretStorage or authentication API) and be passed in from `src/extension.ts`:
 *
 *   tools: [..., createTicketTool(new HttpTicketApi(context.secrets))]
 *
 * Tests pass a fake and can prove a declined proposal never reaches the API.
 * To use it: copy `exampleCreateTicketSchema` into package.json `contributes.languageModelTools`.
 */

export interface TicketApi {
  /** Read-only lookup, allowed in propose(). */
  componentExists(component: string): Promise<boolean>;
  /** The consequential call. Only reachable from execute(). */
  createTicket(ticket: TicketProposal): Promise<{ id: string }>;
}

export interface CreateTicketInput {
  title: string;
  component: string;
  priority?: 'low' | 'normal' | 'critical';
  description?: string;
}

export interface TicketProposal {
  title: string;
  component: string;
  priority: 'low' | 'normal' | 'critical';
  description: string;
}

/** The inputSchema to put in package.json for this tool. */
export const exampleCreateTicketSchema = {
  type: 'object',
  properties: {
    title: { type: 'string', minLength: 5, maxLength: 120, description: 'One-line summary.' },
    component: { type: 'string', maxLength: 64, description: 'Component that owns the ticket.' },
    priority: { type: 'string', enum: ['low', 'normal', 'critical'], description: "Defaults to 'normal'." },
    description: { type: 'string', maxLength: 4000, description: 'Details, steps to reproduce.' },
  },
  required: ['title', 'component'],
  additionalProperties: false,
} as const;

export function createTicketTool(api: TicketApi) {
  return defineTool<CreateTicketInput, TicketProposal>({
    name: 'example_create_ticket',
    category: 'mutate',

    async propose(input) {
      const component = input.component.trim().toLowerCase();
      if (!(await api.componentExists(component))) {
        return invalid({ field: 'component', message: `Unknown component '${component}'. Ask the user which component owns this.` });
      }
      return valid({
        title: input.title.trim(),
        component,
        priority: input.priority ?? 'normal',
        description: input.description?.trim() ?? '',
      });
    },

    describe: (p) => ({
      title: `Create ${p.priority} ticket "${p.title}"`,
      changesState: true,
      resources: [{ path: `tickets/${p.component}`, effect: 'create' }],
      parameters: [['Component', p.component], ['Priority', p.priority], ['Description', `${p.description.length} characters`]],
      warnings: p.priority === 'critical' ? ['Critical tickets page the on-call engineer.'] : [],
    }),

    // Critical tickets page someone: never let VS Code auto-approval create one.
    review: (p) => (p.priority === 'critical' ? { kind: 'extensionConfirmation' } : { kind: 'vscodeConfirmation' }),

    async execute({ proposal }) {
      const { id } = await api.createTicket(proposal);
      return { message: `Created ticket ${id}.`, data: { id } };
    },
  });
}
