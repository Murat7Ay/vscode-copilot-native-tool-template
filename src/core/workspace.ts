import { invalid, valid, type Validation } from './types';

/**
 * The workspace capabilities tools may use. Implemented with VS Code APIs in
 * `src/host/vscodeWorkspace.ts` and with an in-memory fake in tests. Tools depend on this
 * port, not on `vscode`, so their logic survives VS Code API changes untouched.
 *
 * Deliberately narrow: no arbitrary paths outside the workspace, no deletion, no shell.
 */
export interface WorkspacePort {
  /** True when at least one workspace folder is open. */
  readonly isOpen: boolean;
  /** Stat a workspace-relative path (already normalized with `normalizeRelativePath`). */
  stat(relativePath: string): Promise<'file' | 'directory' | undefined>;
  /** Write a UTF-8 text file at a workspace-relative path, creating parent folders. */
  writeTextFile(relativePath: string, content: string, options: { overwrite: boolean }): Promise<void>;
  /** Snapshot of the active text editor, if any. */
  activeEditor(): EditorSnapshot | undefined;
}

export interface EditorSnapshot {
  /** Workspace-relative path, or the file name for files outside the workspace / untitled. */
  readonly path: string;
  readonly languageId: string;
  /** Zero-based positions, matching VS Code. */
  readonly selection: {
    readonly startLine: number;
    readonly startCharacter: number;
    readonly endLine: number;
    readonly endCharacter: number;
  };
  readonly selectedText: string;
}

/**
 * Normalizes an untrusted workspace-relative path. Rejects absolute paths, drive letters,
 * UNC paths, `..` segments and control characters. The host re-checks containment when
 * resolving the path, so this is one of two independent checks.
 */
export function normalizeRelativePath(input: string): Validation<string> {
  const text = input.trim().replace(/\\/g, '/');
  if (text.length === 0) {
    return invalid({ message: 'path must not be empty' });
  }
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f]/.test(text)) {
    return invalid({ message: 'path must not contain control characters' });
  }
  if (text.startsWith('/') || /^[a-zA-Z]:/.test(text)) {
    return invalid({ message: 'path must be relative to the workspace folder' });
  }
  const segments = text.split('/').filter((s) => s !== '' && s !== '.');
  if (segments.some((s) => s === '..')) {
    return invalid({ message: "path must not contain '..'" });
  }
  if (segments.length === 0) {
    return invalid({ message: 'path must not be empty' });
  }
  return valid(segments.join('/'));
}

/** Converts free text into a safe file-name slug: lowercase ASCII letters, digits and '-'. */
export function slugify(text: string, maxLength = 60): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength)
    .replace(/-+$/g, '');
}
