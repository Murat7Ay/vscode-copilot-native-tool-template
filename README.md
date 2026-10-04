<div align="center">

# 🛡️ VS Code Native Tool Template

**Build AI tools for VS Code agent mode where the AI *proposes* and a human *approves*,
before anything actually happens.**

[![CI](https://github.com/Murat7Ay/vscode-copilot-native-tool-template/actions/workflows/ci.yml/badge.svg)](https://github.com/Murat7Ay/vscode-copilot-native-tool-template/actions/workflows/ci.yml)
[![VS Code canary](https://github.com/Murat7Ay/vscode-copilot-native-tool-template/actions/workflows/vscode-canary.yml/badge.svg)](https://github.com/Murat7Ay/vscode-copilot-native-tool-template/actions/workflows/vscode-canary.yml)
![VS Code](https://img.shields.io/badge/VS%20Code-%5E1.99-007ACC?logo=visualstudiocode)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)
![Stable APIs only](https://img.shields.io/badge/proposed%20APIs-none-brightgreen)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

[**Use this template**](https://github.com/Murat7Ay/vscode-copilot-native-tool-template/generate) ·
[Architecture](docs/ARCHITECTURE.md) ·
[Approval & security](docs/APPROVAL-AND-SECURITY.md) ·
[Create a tool](docs/CREATING-A-TOOL.md) ·
[Distribution](docs/DISTRIBUTION.md)

</div>

---

A small, professional foundation for building **native VS Code Language Model Tools**
(`vscode.lm.registerTool` + `contributes.languageModelTools`) that agent mode and other tool
consumers can call. AI prepares structured operations, humans review and approve the
consequential ones, and the extension keeps control of execution.

It is not an MCP server, chat participant or chatbot. It is a plain VS Code extension that
contributes tools through the stable extension API, so it works with any consumer of that
API (GitHub Copilot agent mode today), and it can be packaged as a `.vsix` and distributed
internally.

### Why this template

- 🧾 **Proposal ≠ execution.** Tool calls go through one pipeline: validate → human review →
  execute. Only that pipeline can run a tool, and tests prove declined or cancelled proposals never do.
- 📝 **Review forms pre-filled by the AI.** Complex operations open a native form showing which
  values the AI suggested, which you edited, and which are invalid.
- 🔒 **Honest about approval.** VS Code's tool confirmation can be auto-approved by settings;
  the extension's own modal and form cannot. The docs spell out what the extension, VS Code,
  org policy and the user each guarantee.
- 🧱 **Upgrade-proof.** Tools never import `vscode`; all VS Code code sits in one adapter folder.
  Stable APIs only. CI tests the minimum (1.99) and current VS Code, plus a weekly Insiders canary.
- 🏢 **Built for internal distribution.** VSIX packaging, release workflow, enterprise policy
  examples, and a guide to pinning, updates and rollback.
- 🤖 **AI-agent ready.** `AGENTS.md` and skills in `.claude/skills/` teach Copilot and Claude Code
  to add new tools the safe way.

## The one idea: a tool call is a proposal, not an execution

```text
 AI intent ──► tool input (UNTRUSTED proposal)
                   │
                   ▼
          schema validation          (package.json inputSchema, re-checked by the extension)
                   │
                   ▼
          propose(): business validation, normalization, enrichment   (no side effects)
                   │
                   ▼
          human review               (none │ VS Code confirmation │ extension modal │ extension form)
                   │  declined / cancelled ──► "nothing was executed" returned to the model
                   ▼
          Approved<T>                (minted only by the pipeline, frozen)
                   │
                   ▼
          execute(approved)          ◄── trusted execution boundary
                   │
                   ▼
          result returned to the model
```

The extension owns the line between *"the AI proposed something"* and *"the system did
something"*. A tool never calls its own `execute`; `src/core/pipeline.ts` does, and only with
an `Approved<T>` it minted after review. Unit tests prove that rejected, cancelled, invalid
and forged proposals never reach an executor.

This is an architectural safety pattern, **not** a cryptographic security boundary: code
running in the extension host can do anything the extension can. See
[docs/APPROVAL-AND-SECURITY.md](docs/APPROVAL-AND-SECURITY.md) for exactly what the
extension, VS Code, organization policy and the user each guarantee.

## Two interaction patterns

| | Pattern A: simple operation | Pattern B: complex operation with a form |
|---|---|---|
| Example tool | `template_create_note` | `template_project_operation` |
| AI provides | complete arguments | as many fields as it can infer |
| Human sees | a specific confirmation: what, where, which parameters, whether state changes | a form pre-filled with AI values; AI-suggested, edited, default, empty and invalid fields are marked |
| Mechanism | `prepareInvocation()` → `confirmationMessages` (VS Code's native UI), or the extension's own modal | native QuickPick / InputBox form opened inside `invoke()` |
| Can VS Code auto-approval skip it? | the VS Code confirmation, yes (user/org setting); the extension modal, no | no |

Two more examples cover the low-risk categories: `template_inspect_selection` (read) and
`template_prepare_editorconfig` (prepare: computes a proposal, writes nothing). A fifth,
unregistered example (`examples/tools/createTicket.ts`) shows a tool calling an internal API
through a port, with tests.

## Quick start

```bash
npm install
npm run compile
```

Press **F5** in VS Code to launch an Extension Development Host, open a folder there, start
agent mode in Chat and ask, for example:

- "Use #inspectSelection and explain the selected code."
- "Propose an .editorconfig with 4 spaces; don't write it." → a proposal, nothing written.
- "Create a note called Release checklist with three items." → VS Code asks you to confirm.
- "Propose a project operation to clean up src/billing." → a review form opens.

Check **Output → Native Tool Template** for the audit log (outcome and approval source only).

```bash
npm run lint
npm test                    # unit tests, no VS Code needed
npm run test:integration    # downloads VS Code and runs tests in a real extension host
npm run package             # dist/native-tool-template-<version>.vsix
```

## Building your own tool (the normal path)

1. **`package.json`**: set `name`, `displayName`, `publisher`, `version`, `repository`, and
   rename the `nativeToolTemplate` settings section (also `SETTINGS_SECTION` in `src/extension.ts`).
2. **Declare the tool** in `contributes.languageModelTools`: `name` (`<prefix>_<verb>_<noun>`),
   `displayName`, `userDescription`, `modelDescription`, `inputSchema`, tags (`mutate` for tools that change state).
3. **Implement `propose()`**: business validation, normalization, enrichment. No side effects.
4. **Choose the review**: `{ kind: 'vscodeConfirmation' }`, `{ kind: 'extensionConfirmation' }`
   or `{ kind: 'form', form: {...} }` (or `none` for read/prepare tools).
5. **Implement `execute()`** for the approved proposal, and add the tool to `src/tools/index.ts`.

Step-by-step guide with the exact files: [docs/CREATING-A-TOOL.md](docs/CREATING-A-TOOL.md).
Worked example of a future company tool: [docs/EXAMPLE-SERVICE-DEFINITION.md](docs/EXAMPLE-SERVICE-DEFINITION.md).

## Tool categories

Architectural guidance for reviewers, **not** a replacement for VS Code's permission model:

| Category | Examples | Template rule |
|---|---|---|
| `read` | inspect code, search workspace, read metadata | review `none` allowed |
| `prepare` | generate configuration, calculate changes | review `none` allowed; returns a proposal, changes nothing |
| `mutate` | write files, call internal APIs, create business objects | review required; `defineTool` throws on `none`, and the pipeline fails closed to the extension modal if a policy function returns `none` |

## Repository layout

```text
src/
  extension.ts            activation: wires host adapters to the tool list
  core/                   VS Code-free (ESLint forbids importing 'vscode' here)
    types.ts              categories, validation results, OperationSummary, ExecutionResult
    tool.ts               ToolDefinition, ReviewPolicy, defineTool() rules
    pipeline.ts           prepareTool / runTool, Approved<T>, the only caller of execute()
    schema.ts             runtime validation of the package.json inputSchema subset
    form.ts               form model: field origins, parsing, required checks
    ledger.ts             ties VS Code confirmations to the exact input that was confirmed
    summary.ts            escaped Markdown / plain-text rendering of confirmations
    workspace.ts          WorkspacePort interface, path normalization
  host/                   the VS Code compatibility boundary
    registerTools.ts      ToolDefinition → vscode.LanguageModelTool (prepareInvocation, invoke, results)
    reviewGateway.ts      extension-owned modal confirmation and form
    quickPickForm.ts      QuickPick / InputBox form renderer
    vscodeWorkspace.ts    WorkspacePort via vscode.workspace.fs
    capabilities.ts       runtime feature detection; home for any future proposed API use
  tools/                  your tools (VS Code-free): read, prepare, simple confirmation, form examples
examples/                 internal-API tool via a port, prompts, policy and settings examples
.claude/skills/           AI agent skills (VS Code agent mode + Claude Code)
AGENTS.md                 rules for AI coding agents
test/
  unit/                   node:test; pipeline, approval, form, tools, examples, manifest, skills
  integration/            real VS Code extension host via @vscode/test-electron
docs/                     architecture, approval & security, distribution, compatibility, maintenance
```

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): layers, abstractions and why each exists, both flows.
- [docs/APPROVAL-AND-SECURITY.md](docs/APPROVAL-AND-SECURITY.md): VS Code's permission model, who guarantees what, threat model.
- [docs/CREATING-A-TOOL.md](docs/CREATING-A-TOOL.md): the files a developer changes.
- [docs/DISTRIBUTION.md](docs/DISTRIBUTION.md): development, pilot, company-wide, controlled releases, updates, rollback.
- [docs/COMPATIBILITY.md](docs/COMPATIBILITY.md): stable vs proposed APIs, engine versions, upgrading many derived extensions.
- [docs/TESTING.md](docs/TESTING.md): what is tested where, and what still needs a human with Copilot.
- [docs/MAINTENANCE.md](docs/MAINTENANCE.md): what to do when VS Code is updated; monthly checklist; propagating template releases.
- [examples/](examples/README.md): prompts, an internal-API tool via a port, enterprise policy and settings files.

## For AI coding agents

The repository is set up for AI-assisted development of new tools:

- [AGENTS.md](AGENTS.md): rules every agent must follow (read by Copilot, Codex, Cursor; `CLAUDE.md` imports it for Claude Code).
- `.claude/skills/` (loaded by both VS Code agent mode and Claude Code):
  - `create-language-model-tool`: add a tool the template way, with tests.
  - `review-tool-safety`: review a tool change against the approval and security rules.
  - `upgrade-vscode-baseline`: what to check and change when VS Code or the company baseline changes.

A unit test validates the skill files (frontmatter, referenced paths).

## Requirements

- VS Code **1.99** or later (`engines.vscode: ^1.99.0`). Agent mode, and therefore the main
  consumer of these tools, needs a Copilot plan or another tool-calling chat provider.
- Node.js 22 for development.

## License

MIT
