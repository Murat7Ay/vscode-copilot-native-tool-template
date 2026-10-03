# Agent instructions

Instructions for AI coding agents (GitHub Copilot, Claude Code, Codex, Cursor …) working in
this repository. Humans: see README.md and docs/.

## What this repository is

A template for VS Code extensions that contribute **native Language Model Tools**
(`vscode.lm.registerTool` + `contributes.languageModelTools`). Its central rule:

> A tool call is a **proposal**, not an execution. Untrusted input → schema validation →
> `propose()` → human review → `Approved<T>` → `execute()`.

## Hard rules

1. **Never import `vscode` in `src/core/` or `src/tools/`.** Only `src/host/` and
   `src/extension.ts` may. ESLint enforces it. Need a new side effect? Add a port (interface)
   in core or the tool file, implement it in `src/host/`, fake it in `test/unit/fakes.ts`.
2. **Never call a tool's `execute()` directly.** Only `src/core/pipeline.ts` does, with an
   `Approved<T>` it minted. Don't construct `Approved` objects yourself.
3. **`mutate` tools must have a human review** (`vscodeConfirmation`, `extensionConfirmation` or
   `form`). Use `extensionConfirmation` or `form` when the operation must never be
   auto-approved by VS Code settings. `none` is only for `read` and `prepare`.
4. **`propose()` and `prepareInvocation` must be free of side effects.** They also run for
   every form edit and may not be followed by `invoke`.
5. **Treat all tool input as untrusted**, including text that ends up in confirmations. Use
   `normalizeRelativePath` for paths and keep writes inside fixed workspace folders.
6. **No** `child_process`, shell commands, `eval`, arbitrary URL fetching, credentials in tool
   input/results/`modelDescription`, or proposed VS Code APIs (except behind
   `src/host/capabilities.ts`, with docs).
7. **`package.json` is the schema source of truth.** Every tool in `src/tools/index.ts` has a
   `contributes.languageModelTools` entry with the same `name`; schemas use only the keywords
   `src/core/schema.ts` supports; `mutate` tools carry the `mutate` tag.
8. **Don't modify `src/core/` or `src/host/` while building a tool.** Derived extensions keep
   them identical to the template so template upgrades stay mechanical. Changing them is a
   template change: update docs/ and CHANGELOG.md too.
9. **Keep `@types/vscode` equal to the `engines.vscode` minimum.** Don't bump either to fix a
   type error; read docs/COMPATIBILITY.md.

## Commands

```bash
npm run compile            # tsc
npm run lint               # eslint
npm test                   # compile + unit tests (fast, no VS Code)
npm run test:integration   # real VS Code; VSCODE_TEST_VERSION=1.99.3|stable|insiders
npm run package            # dist/*.vsix
npm run verify             # lint + test + package
```

Always run `npm run verify` before finishing. Run `npm run test:integration` after touching
`src/host/`, `package.json` contributions, or `engines.vscode`.

## Skills

Task playbooks live in `.claude/skills/` (read by Claude Code and by VS Code agent mode):

- `create-language-model-tool`: add a new tool the template way.
- `review-tool-safety`: review a tool change against the approval and security rules.
- `upgrade-vscode-baseline`: what to do when VS Code (or the company baseline) changes.

## Map

| Path | Purpose |
|---|---|
| `src/core/pipeline.ts` | `prepareTool` / `runTool`, `Approved<T>`, the only caller of `execute()` |
| `src/core/tool.ts` | `ToolDefinition`, `ReviewPolicy`, `defineTool()` rules |
| `src/core/form.ts` | form model (field origins, parsing, required checks) |
| `src/host/registerTools.ts` | adapter to `vscode.lm.registerTool` |
| `src/host/quickPickForm.ts` | QuickPick form renderer |
| `src/tools/*.ts` | example tools: read, prepare, simple confirmation, form |
| `test/unit/fakes.ts` | `FakeWorkspace`, `FakeGateway` (scripted human), `FakeToken` |
| `docs/` | architecture, approval & security, distribution, compatibility, maintenance |
