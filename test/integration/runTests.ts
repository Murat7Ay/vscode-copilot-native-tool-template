import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runTests } from '@vscode/test-electron';

/**
 * Launches a real VS Code with this extension under development and runs ./suite in its
 * extension host. Set VSCODE_TEST_VERSION to test a specific version (e.g. the engines
 * minimum, 1.99.3) or 'insiders'; default 'stable'. Other installed extensions are disabled,
 * so this does NOT exercise Copilot or agent mode; it exercises the VS Code tool API itself.
 */
async function main(): Promise<void> {
  const workspace = mkdtempSync(join(tmpdir(), 'native-tool-template-'));
  mkdirSync(join(workspace, 'src', 'billing'), { recursive: true });
  writeFileSync(join(workspace, 'src', 'billing', 'Invoice.java'), 'class Invoice {\n  int total() { return 42; }\n}\n');

  await runTests({
    version: process.env.VSCODE_TEST_VERSION ?? 'stable',
    extensionDevelopmentPath: resolve(__dirname, '../../..'),
    extensionTestsPath: resolve(__dirname, './suite'),
    launchArgs: [workspace, '--disable-extensions', '--skip-welcome', '--skip-release-notes', '--disable-workspace-trust'],
  });
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
