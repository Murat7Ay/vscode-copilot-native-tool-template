import { defineTool } from '../core/tool';
import { valid } from '../core/types';

/**
 * Category: prepare. Computes a proposal (the content of an .editorconfig file) and returns it
 * WITHOUT writing anything, so no human review is needed. The agent can show the proposal to
 * the user, or pass it to a mutate tool that has its own review.
 */

export interface PrepareEditorConfigInput {
  indentStyle: 'space' | 'tab';
  indentSize?: number;
  endOfLine?: 'lf' | 'crlf';
  insertFinalNewline?: boolean;
}

interface EditorConfigProposal {
  indentStyle: 'space' | 'tab';
  indentSize: number;
  endOfLine: 'lf' | 'crlf';
  insertFinalNewline: boolean;
}

export const EDITORCONFIG_PATH = '.editorconfig';

export const prepareEditorConfigTool = defineTool<PrepareEditorConfigInput, EditorConfigProposal>({
  name: 'template_prepare_editorconfig',
  category: 'prepare',

  propose: (input) => valid({
    indentStyle: input.indentStyle,
    indentSize: input.indentSize ?? (input.indentStyle === 'tab' ? 4 : 2),
    endOfLine: input.endOfLine ?? 'lf',
    insertFinalNewline: input.insertFinalNewline ?? true,
  }),

  describe: (p) => ({
    title: 'Prepare an .editorconfig proposal',
    changesState: false,
    resources: [{ path: EDITORCONFIG_PATH, effect: 'none' }],
    parameters: [['Indent', `${p.indentSize} ${p.indentStyle}`], ['End of line', p.endOfLine]],
  }),

  review: { kind: 'none' },

  async execute({ proposal }, { workspace }) {
    const content = [
      'root = true',
      '',
      '[*]',
      `indent_style = ${proposal.indentStyle}`,
      `indent_size = ${proposal.indentSize}`,
      `end_of_line = ${proposal.endOfLine}`,
      `insert_final_newline = ${proposal.insertFinalNewline}`,
      'charset = utf-8',
      '',
    ].join('\n');
    const exists = (await workspace.stat(EDITORCONFIG_PATH)) === 'file';
    return {
      message: `Prepared an .editorconfig proposal. Nothing was written${exists ? '; an .editorconfig already exists and would be replaced' : ''}.`,
      data: { path: EDITORCONFIG_PATH, existingFile: exists, content },
    };
  },
});
