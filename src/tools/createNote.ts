import { defineTool } from '../core/tool';
import { invalid, valid } from '../core/types';
import { slugify } from '../core/workspace';

/**
 * Category: mutate. Pattern A: simple operation with a confirmation.
 *
 * - New note → VS Code's native confirmation (shown in chat; user/org may auto-approve).
 * - Replacing an existing note → the extension's own modal confirmation, which VS Code
 *   auto-approval cannot skip. This shows how the review can depend on the proposal.
 */

export interface CreateNoteInput {
  title: string;
  body: string;
  overwrite?: boolean;
}

interface CreateNoteProposal {
  title: string;
  body: string;
  path: string;
  replacesExisting: boolean;
}

export const NOTES_FOLDER = 'notes';

export const createNoteTool = defineTool<CreateNoteInput, CreateNoteProposal>({
  name: 'template_create_note',
  category: 'mutate',

  async propose(input, { workspace }) {
    if (!workspace.isOpen) {
      return invalid({ message: 'No workspace folder is open. Ask the user to open a folder first.' });
    }
    const title = input.title.trim();
    const slug = slugify(title);
    if (slug === '') {
      return invalid({ field: 'title', message: 'title must contain at least one letter or digit' });
    }
    const path = `${NOTES_FOLDER}/${slug}.md`;
    const existing = await workspace.stat(path);
    if (existing === 'directory') {
      return invalid({ field: 'title', message: `${path} is a folder; choose a different title` });
    }
    if (existing === 'file' && input.overwrite !== true) {
      return invalid({
        field: 'overwrite',
        message: `${path} already exists. Ask the user whether to replace it; if so, call again with overwrite: true.`,
      });
    }
    return valid({ title, body: input.body.trim(), path, replacesExisting: existing === 'file' });
  },

  describe: (p) => ({
    title: p.replacesExisting ? `Replace note "${p.title}"` : `Create note "${p.title}"`,
    changesState: true,
    resources: [{ path: p.path, effect: p.replacesExisting ? 'overwrite' : 'create' }],
    parameters: [
      ['Title', p.title],
      ['Body', `${p.body.length} characters`],
    ],
    warnings: p.replacesExisting ? ['The existing file will be replaced.'] : [],
  }),

  review: (p) => (p.replacesExisting ? { kind: 'extensionConfirmation' } : { kind: 'vscodeConfirmation' }),

  async execute({ proposal }, { workspace }) {
    await workspace.writeTextFile(proposal.path, `# ${proposal.title}\n\n${proposal.body}\n`, {
      overwrite: proposal.replacesExisting,
    });
    return {
      message: `${proposal.replacesExisting ? 'Replaced' : 'Created'} ${proposal.path}.`,
      data: { path: proposal.path },
    };
  },
});
