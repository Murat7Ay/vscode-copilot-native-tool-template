import type { AnyToolDefinition } from '../core/tool';
import { createNoteTool } from './createNote';
import { inspectSelectionTool } from './inspectSelection';
import { prepareEditorConfigTool } from './prepareEditorConfig';
import { projectOperationTool } from './projectOperation';

/** Every tool this extension registers. Each must have a matching entry in package.json. */
export const tools: readonly AnyToolDefinition[] = [inspectSelectionTool, prepareEditorConfigTool, createNoteTool, projectOperationTool];
