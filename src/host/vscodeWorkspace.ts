import * as vscode from 'vscode';
import { normalizeRelativePath, type EditorSnapshot, type WorkspacePort } from '../core/workspace';

/** WorkspacePort backed by `vscode.workspace.fs`. Works for local and remote workspaces. */
export function createVscodeWorkspace(): WorkspacePort {
  const root = (): vscode.Uri | undefined => vscode.workspace.workspaceFolders?.[0]?.uri;

  /** Resolves a relative path inside the first workspace folder, re-checking containment. */
  const resolve = (relativePath: string): vscode.Uri => {
    const base = root();
    if (!base) {
      throw new Error('No workspace folder is open.');
    }
    const normalized = normalizeRelativePath(relativePath);
    if (!normalized.ok) {
      throw new Error(`Invalid workspace path: ${normalized.issues[0]?.message ?? relativePath}`);
    }
    const uri = vscode.Uri.joinPath(base, ...normalized.value.split('/'));
    const basePath = base.path.endsWith('/') ? base.path : `${base.path}/`;
    if (!uri.path.startsWith(basePath)) {
      throw new Error('Path escapes the workspace folder.');
    }
    return uri;
  };

  return {
    get isOpen() {
      return root() !== undefined;
    },

    async stat(relativePath) {
      try {
        const stat = await vscode.workspace.fs.stat(resolve(relativePath));
        return stat.type & vscode.FileType.Directory ? 'directory' : 'file';
      } catch {
        return undefined;
      }
    },

    async writeTextFile(relativePath, content, { overwrite }) {
      const uri = resolve(relativePath);
      if (!overwrite) {
        const exists = await vscode.workspace.fs.stat(uri).then(() => true, () => false);
        if (exists) {
          throw new Error(`${relativePath} already exists.`);
        }
      }
      await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(uri, '..'));
      await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(content));
    },

    activeEditor(): EditorSnapshot | undefined {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        return undefined;
      }
      const { document, selection } = editor;
      return {
        path: document.isUntitled ? document.fileName : vscode.workspace.asRelativePath(document.uri, false),
        languageId: document.languageId,
        selection: {
          startLine: selection.start.line,
          startCharacter: selection.start.character,
          endLine: selection.end.line,
          endCharacter: selection.end.character,
        },
        selectedText: document.getText(selection),
      };
    },
  };
}
