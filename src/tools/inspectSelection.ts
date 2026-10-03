import { truncate } from '../core/summary';
import { defineTool } from '../core/tool';
import { valid } from '../core/types';

/**
 * Category: read. No side effects, so no human review. Demonstrates the smallest possible tool.
 */

export interface InspectSelectionInput {
  maxCharacters?: number;
}

interface InspectSelectionProposal {
  maxCharacters: number;
}

export const inspectSelectionTool = defineTool<InspectSelectionInput, InspectSelectionProposal>({
  name: 'template_inspect_selection',
  category: 'read',

  propose: (input) => valid({ maxCharacters: input.maxCharacters ?? 4000 }),

  describe: (proposal) => ({
    title: 'Read the active editor selection',
    changesState: false,
    resources: [],
    parameters: [['Max characters', String(proposal.maxCharacters)]],
  }),

  review: { kind: 'none' },

  async execute({ proposal }, { workspace }) {
    const editor = workspace.activeEditor();
    if (!editor) {
      return { message: 'There is no active text editor. Ask the user to open a file and select code.' };
    }
    const { selection } = editor;
    const text = truncate(editor.selectedText, proposal.maxCharacters);
    return {
      message: editor.selectedText.length === 0
        ? `The active editor is ${editor.path} (${editor.languageId}); nothing is selected.`
        : `Selection in ${editor.path} (${editor.languageId}), lines ${selection.startLine + 1}-${selection.endLine + 1}.`,
      data: {
        path: editor.path,
        languageId: editor.languageId,
        selection,
        selectedText: text,
        truncated: text.length < editor.selectedText.length,
      },
    };
  },
});
