// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['out/', 'dist/', 'node_modules/', '.vscode-test/'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    rules: {
      eqeqeq: 'error',
      curly: 'error',
      'no-restricted-syntax': [
        'error',
        { selector: "CallExpression[callee.name='eval']", message: 'eval is not allowed.' },
        { selector: "NewExpression[callee.name='Function']", message: 'new Function is not allowed.' },
      ],
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'child_process', message: 'Tools must not run shell commands.' },
            { name: 'node:child_process', message: 'Tools must not run shell commands.' },
          ],
        },
      ],
    },
  },
  {
    // Compatibility boundary: core logic and tools never import the VS Code API.
    files: ['src/core/**/*.ts', 'src/tools/**/*.ts', 'examples/tools/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'vscode', message: 'Only src/host and src/extension.ts may import vscode. Use a port from src/core instead.' },
            { name: 'child_process', message: 'Tools must not run shell commands.' },
            { name: 'node:child_process', message: 'Tools must not run shell commands.' },
          ],
        },
      ],
    },
  },
);
