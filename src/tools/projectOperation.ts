import { defineTool } from '../core/tool';
import { invalid, valid, type ValidationIssue } from '../core/types';
import { normalizeRelativePath } from '../core/workspace';

/**
 * Category: mutate. Pattern B: complex operation reviewed in a form.
 *
 * The AI fills in whatever it can. The extension validates and enriches the proposal, opens a
 * form pre-filled with the AI's values, and the human edits, cancels or submits. Only the
 * submitted values execute. The operation itself is harmless: it writes a JSON record (or,
 * in preview mode, writes nothing).
 */

export type OperationMode = 'preview' | 'record';
export type Priority = 'low' | 'normal' | 'high';

/** The AI may leave any field out; the form makes the human complete it. */
export interface ProjectOperationInput {
  name?: string;
  description?: string;
  target?: string;
  mode?: OperationMode;
  priority?: Priority;
  tags?: string[];
  timeoutSeconds?: number;
}

export interface ProjectOperationProposal {
  name: string;
  description: string;
  target: string;
  /** Enrichment: looked up by the extension, not provided by the AI. */
  targetKind: 'file' | 'directory';
  mode: OperationMode;
  priority: Priority;
  tags: string[];
  timeoutSeconds: number;
  recordPath: string;
}

export const OPERATIONS_FOLDER = '.project-operations';
const NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{2,63}$/;
const TAG_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

export const projectOperationTool = defineTool<ProjectOperationInput, ProjectOperationProposal>({
  name: 'template_project_operation',
  category: 'mutate',

  review: {
    kind: 'form',
    form: {
      title: 'Review project operation',
      fields: [
        { key: 'name', label: 'Name', kind: 'text', required: true, help: 'Starts with a letter; letters, digits, - or _ (3-64 characters).' },
        { key: 'description', label: 'Description', kind: 'text', required: true },
        { key: 'target', label: 'Target', kind: 'text', required: true, help: 'Workspace-relative path of an existing file or folder.' },
        { key: 'mode', label: 'Mode', kind: 'choice', required: true, options: ['preview', 'record'], defaultValue: 'preview' },
        { key: 'priority', label: 'Priority', kind: 'choice', options: ['low', 'normal', 'high'], defaultValue: 'normal' },
        { key: 'tags', label: 'Tags', kind: 'list', help: 'Comma-separated, e.g. backend, cleanup' },
        { key: 'timeoutSeconds', label: 'Timeout (seconds)', kind: 'integer', defaultValue: 60, help: 'Between 1 and 3600.' },
      ],
    },
  },

  async propose(input, { workspace }) {
    if (!workspace.isOpen) {
      return invalid({ message: 'No workspace folder is open. Ask the user to open a folder first.' });
    }
    const issues: ValidationIssue[] = [];

    const name = input.name?.trim() ?? '';
    if (!NAME_PATTERN.test(name)) {
      issues.push({ field: 'name', message: 'Name must start with a letter and use 3-64 letters, digits, - or _' });
    }
    const description = input.description?.trim() ?? '';
    if (description === '') {
      issues.push({ field: 'description', message: 'Description is required' });
    }

    let target = '';
    let targetKind: 'file' | 'directory' | undefined;
    const normalized = normalizeRelativePath(input.target ?? '');
    if (!normalized.ok) {
      issues.push({ field: 'target', message: `Target ${normalized.issues[0]?.message ?? 'is invalid'}` });
    } else {
      target = normalized.value;
      targetKind = await workspace.stat(target);
      if (!targetKind) {
        issues.push({ field: 'target', message: `Target '${target}' does not exist in the workspace` });
      }
    }

    const tags = [...new Set((input.tags ?? []).map((t) => t.trim().toLowerCase()).filter((t) => t !== ''))];
    const badTag = tags.find((t) => !TAG_PATTERN.test(t));
    if (badTag !== undefined) {
      issues.push({ field: 'tags', message: `Tag '${badTag}' may only contain lowercase letters, digits and '-'` });
    }

    const mode = input.mode ?? 'preview';
    const recordPath = `${OPERATIONS_FOLDER}/${name}.json`;
    if (mode === 'record' && NAME_PATTERN.test(name) && (await workspace.stat(recordPath))) {
      issues.push({ field: 'name', message: `An operation named '${name}' is already recorded; choose another name` });
    }

    if (issues.length > 0 || !targetKind) {
      return invalid(...issues);
    }
    return valid({
      name,
      description,
      target,
      targetKind,
      mode,
      priority: input.priority ?? 'normal',
      tags,
      timeoutSeconds: input.timeoutSeconds ?? 60,
      recordPath,
    });
  },

  async execute({ proposal, approval }, { workspace }) {
    const { recordPath, ...operation } = proposal;
    const changedByUser = approval.fields?.user ?? [];
    if (proposal.mode === 'preview') {
      return {
        message: `Preview of operation '${proposal.name}' approved. Nothing was written.`,
        data: { operation, changedByUser },
      };
    }
    const record = { schemaVersion: 1, operation, approval };
    await workspace.writeTextFile(recordPath, `${JSON.stringify(record, null, 2)}\n`, { overwrite: false });
    return {
      message: `Recorded operation '${proposal.name}' at ${recordPath}.`,
      data: { recordPath, operation, changedByUser },
    };
  },
});
