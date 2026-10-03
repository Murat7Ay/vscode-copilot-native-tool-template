# Architecture

## Layers

```text
┌──────────────────────────────────────────────────────────────────────┐
│ VS Code (agent mode / any lm.invokeTool caller)                       │
└───────────────┬──────────────────────────────────────────────────────┘
                │ prepareInvocation(input)        invoke(input, token)
┌───────────────▼──────────────────────────────────────────────────────┐
│ src/host   — the ONLY code that imports 'vscode'                      │
│   registerTools.ts   LanguageModelTool adapter, result conversion     │
│   reviewGateway.ts   modal confirmation, form  (ReviewGateway port)    │
│   quickPickForm.ts   QuickPick/InputBox renderer                       │
│   vscodeWorkspace.ts workspace.fs, active editor (WorkspacePort)       │
└───────────────┬──────────────────────────────────────────────────────┘
                │ plain TypeScript interfaces
┌───────────────▼──────────────────────────────────────────────────────┐
│ src/core   — pipeline, approval, validation, form model, rendering    │
└───────────────┬──────────────────────────────────────────────────────┘
                │ ToolDefinition
┌───────────────▼──────────────────────────────────────────────────────┐
│ src/tools  — propose / describe / review / execute per tool           │
└──────────────────────────────────────────────────────────────────────┘
```

`src/core` and `src/tools` cannot import `vscode` (ESLint `no-restricted-imports`). That is
the compatibility boundary: a VS Code API change touches `src/host`, not every tool in every
derived extension. It also makes the core and the tools unit-testable in plain Node.

## Why each abstraction exists

| Abstraction | File | Why it exists |
|---|---|---|
| `ToolDefinition` | `core/tool.ts` | One small contract per tool: `propose`, `describe`, `review`, `execute`. A developer fills in four functions; no framework to learn. |
| `defineTool()` | `core/tool.ts` | Fails fast on template rule violations: a `mutate` tool without review, reserved name prefixes, a missing `describe`. |
| `ReviewPolicy` | `core/tool.ts` | Makes the human review an explicit, reviewable declaration instead of ad-hoc code in each tool. |
| `runTool` / `prepareTool` | `core/pipeline.ts` | The only path from input to execution, and the only caller of `execute()`. Every tool gets the same order: schema → propose → review → execute. |
| `Approved<T>` | `core/pipeline.ts` | Separates "AI input" from "human-approved value" in the type system and at runtime. Minted only by the pipeline (tracked in a `WeakSet`), deep-frozen so the approved value cannot change before execution. |
| `ApprovalRecord` | `core/pipeline.ts` | Records how approval was obtained (`not-required`, `vscode-confirmation`, `extension-confirmation`, `extension-form`) and, for forms, which fields the human changed. Logged and returned to the model. |
| `ConfirmationLedger` | `core/ledger.ts` | `prepareInvocation` and `invoke` are separate calls. The ledger lets `invoke` trust VS Code's confirmation only if `prepareInvocation` requested it for exactly this input; otherwise it escalates to the extension modal. |
| `validateSchema` | `core/schema.ts` | Re-checks input against the `inputSchema` declared in package.json (single source of truth). A manifest test fails the build if a schema uses keywords the validator doesn't enforce. |
| `FormSpec` / `FormState` | `core/form.ts` | A UI-independent form model: field origins (AI / user / default / empty), parsing, required checks. The renderer is replaceable; the behavior is tested once. |
| `ReviewGateway` | `core/pipeline.ts` | The port for extension-owned UI. Real implementation in `host/reviewGateway.ts`; scripted fake in tests, which is how "rejected never executes" is proven. |
| `WorkspacePort` | `core/workspace.ts` | The narrow set of side effects tools may use (stat, write text file inside the workspace, read the active editor). No delete, no shell, no network. |
| `OperationSummary` + `summary.ts` | `core/types.ts` | One description of an operation, rendered as escaped Markdown for VS Code's confirmation or plain text for the modal. AI-provided text cannot inject links or formatting. |
| `capabilities.ts` | `host/` | Feature detection for editors that report a compatible version but lack an API, and the single place where a proposed API would be isolated. |

Things deliberately **not** abstracted: logging (a `LogOutputChannel`), settings (one boolean),
tool results (plain text). They are small and stable enough to use directly.

## Pattern A: simple operation flow (`template_create_note`)

```text
Agent calls template_create_note({ title, body })
  │
  ├─ VS Code → prepareInvocation()            [side-effect free]
  │     prepareTool: schema ✓ → propose ✓ (path notes/<slug>.md, exists?)
  │     review(proposal):
  │        new file      → vscodeConfirmation  → ledger.record(input)
  │                         returns confirmationMessages { title, escaped Markdown summary }
  │        existing file → extensionConfirmation (invocationMessage only)
  │
  ├─ VS Code shows its confirmation (unless auto-approved by user/org configuration)
  │     Cancel → invoke() is never called → nothing happens
  │
  └─ VS Code → invoke()
        runTool: schema ✓ → propose ✓ (re-run: the workspace may have changed)
        review:
          vscodeConfirmation + ledger.consume(input) ✓ → approved (source: vscode-confirmation)
          vscodeConfirmation but not in ledger         → escalate to extension modal
          extensionConfirmation                         → modal "Approve" / close
        declined → "The user declined … Nothing was executed."
        approved → execute(Approved) → "Created notes/x.md."
```

A good confirmation says what will happen, which resource is affected, the important
parameters, and whether state changes:

```text
Create note "Release Checklist"

Affected resources:
- create: notes/release-checklist.md

| Parameter | Value          |
| Title     | Release Checklist |
| Body      | 42 characters  |

This operation changes the workspace.
```

## Pattern B: complex form flow (`template_project_operation`)

```text
Agent calls template_project_operation({ name, description, target, mode, tags, … partial })
  │
  ├─ prepareInvocation(): schema ✓ → "Waiting for your review: Review project operation"
  │     (no VS Code confirmation: the form is the confirmation; avoids double prompts)
  │
  └─ invoke():
        schema ✓ (malformed structure → error to the model, form never opens)
        FormState from AI input: AI values ($(sparkle)), defaults, empty fields
        validate(values) = schema + required + propose()  → issues shown per field ($(error))
        ┌─ QuickPick form ──────────────────────────────────────────────┐
        │ ✨ Name *          cleanupBilling     AI suggested · required   │
        │ ✏ Priority         high               Edited by you · optional │
        │ ⛔ Target *         src/missing        … does not exist         │
        │ ✔ Submit / ↺ Reset to AI suggestions / ✕ Cancel                │
        └───────────────────────────────────────────────────────────────┘
        Esc / token cancel → cancelled;  Cancel → declined;  Submit with issues → stays open
        Submit → re-validate submitted values (never trust the UI) → propose() → Approved
        execute(Approved): preview → nothing written; record → .project-operations/<name>.json
        result tells the model which fields the human changed
```

### Why QuickPick and not a Webview

The form needs: pre-filled values, per-field status, edit one field, see errors, accept all,
cancel, submit. QuickPick + InputBox do this with stable APIs, keyboard-first, themed and
accessible, with no HTML, CSP, message passing or state restoration to maintain. The
pipeline only sees the `ReviewGateway.reviewForm(session)` port, so a tool with genuinely
richer needs (tables, long multi-line text, previews) can get a Webview renderer for the
same `FormSession` without touching the pipeline or other tools.

Considered and rejected as the default:

- **Webview / WebviewView**: justified only for rich layouts; much more code and its own security surface.
- **Custom editor**: for documents, not transient approvals.
- **Chat-rendered UI** (e.g. proposed chat output renderers): not stable, and couples the form to the chat UI.
- **Sequential InputBoxes only**: no overview, no "accept all", no per-field status.

## Why the extension-owned UI matters

`prepareInvocation().confirmationMessages` asks VS Code to confirm, but VS Code may
auto-approve it (per-tool "Allow" choices, global auto-approve, the Allow-all/Autopilot
permission levels). Code running inside `invoke()` is outside that mechanism, so the
extension modal and the form are always shown. See
[APPROVAL-AND-SECURITY.md](APPROVAL-AND-SECURITY.md).
