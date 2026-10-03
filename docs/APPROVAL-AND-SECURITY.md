# Approval and security

Researched October 2026 against VS Code 1.140 (`@types/vscode` 1.140.0), the VS Code
documentation, and the VS Code source on `main`
(`src/vs/workbench/contrib/chat/browser/tools/languageModelToolsService.ts`). Where the docs
and the source disagreed, this document follows the source and says so.

## The security boundary

```text
AI (language model)
  │  tool call: arbitrary JSON chosen by the model, possibly influenced by
  │  prompt injection from files, web pages, issues, tool results …
  ▼
UNTRUSTED proposal
  │  1. schema validation        package.json inputSchema, re-checked in the extension
  │  2. business validation      propose(): normalize, check rules, enrich from the workspace
  ▼
validated proposal (still untrusted intent)
  │  3. human review             VS Code confirmation / extension modal / extension form
  ▼
Approved<T>  (minted only by the pipeline, frozen)
  │  4. execution                execute(): the trusted execution boundary
  ▼
result → back to the model (no secrets)
```

Never assume "the model generated it, therefore it is safe". The user started the
conversation, but the arguments come from a model that may have read malicious content.

This is an **architectural safety pattern, not a cryptographic security boundary**. Any code
in the extension host can call any API; a careless or malicious change to a tool can bypass
the pipeline. The pattern makes the safe path the easy path, makes deviations visible in
review, and is enforced by tests and lint rules. It cannot stop someone with commit access.

## How VS Code approves tools today

Stable API (`vscode.d.ts`):

- `prepareInvocation(options, token)` runs before `invoke`. It "must be free of
  side-effects", and it "is not necessarily followed by a call to invoke".
- It may return `invocationMessage` (progress text) and `confirmationMessages: { title, message }`.
  If `confirmationMessages` is present, VS Code asks the user to confirm (Continue / Cancel,
  plus "Allow" scope options).
- There is no stable API for argument-specific approval, for knowing whether a confirmation
  was auto-approved, or for forbidding auto-approval.

Behavior observed in the VS Code source (`main`, October 2026):

| Situation | What VS Code does |
|---|---|
| Tool returns `confirmationMessages` | Shows the confirmation unless an auto-approval rule applies. |
| Tool returns no `confirmationMessages` | **Runs without asking**, unless the tool is marked ineligible (next row). The tools guide says "a generic confirmation dialog will always be shown for tools from extensions"; the current source does not do that. Don't rely on either: if a tool needs confirmation, return `confirmationMessages`. |
| `chat.tools.eligibleForAutoApproval: { "<tool>": false }` | Forces a confirmation (a generic one if the tool supplies none) and hides the "always allow" options. |
| User chose "Allow" for session / workspace / always | Later calls of that tool are auto-approved (approval is per tool, not per argument). Reset with **Chat: Reset Tool Confirmations**; manage with **Chat: Manage Tool Approval**. |
| `chat.tools.global.autoApprove: true` | Auto-approves eligible tools. |
| Session permission level **Allow all** or **Autopilot** | Skips confirmations, **checked before eligibility**, so even ineligible tools run without a prompt, unless the `ChatToolsAutoApprove` policy sets `chat.tools.global.autoApprove` to `false`. |
| `preToolUse` hook returns `allow` / `ask` | Approves without a prompt, or forces a confirmation. |
| Not in a chat request (`lm.invokeTool` with no token) | Confirmations become a native dialog. |

Proposed (Insiders-only, not usable in published extensions):
`toolInvocationApproveCombination` adds `approveCombination` for per-argument approval;
`chatParticipantPrivate` exposes `permissionLevel` and `forceConfirmationReason`.

## Who guarantees what

| Party | Guarantees | Cannot guarantee |
|---|---|---|
| **This extension** | Malformed or invalid input never executes. `mutate` tools always have a review policy. Rejected, cancelled, invalid or forged proposals never reach `execute()`. The approved value is frozen. The **extension modal and the form are always shown**, because they run inside `invoke()`, outside VS Code's approval mechanism. VS Code confirmation is trusted only for the exact input `prepareInvocation` asked about. Confirmations escape AI-provided text. | That VS Code shows its own confirmation (`vscodeConfirmation`). That a human, not a script or another extension, clicked the button. That future maintainers keep the pipeline. |
| **VS Code** | Shows `confirmationMessages` when no auto-approval rule applies. Enforces policy-locked settings. Respects `chat.extensionTools.enabled`. | That the tool's confirmation is shown at all once the user or org enabled auto-approval. |
| **Organization policy** (GPO / MDM / `policy.json`) | Can disable agent mode (`ChatAgentMode`), extension tools (`ChatAgentExtensionTools`), global auto-approve **and** the Allow-all/Autopilot bypass (`ChatToolsAutoApprove` = false), force manual approval per tool (`ChatToolsEligibleForAutoApproval`), and restrict which extensions and versions may be installed (`AllowedExtensions`). | Behavior of extension-owned UI, or what an approved extension does. |
| **The user** | Decides what to approve. Can configure auto-approval within what policy allows. | Anything, if they approve without reading. |

### Recommended configuration for consequential tools

1. In the tool: use `extensionConfirmation` or `form` for operations that must always have a
   human in the loop. Use `vscodeConfirmation` where VS Code's (bypassable) confirmation is
   acceptable. The example `template_create_note` does both: VS Code confirmation for a new
   note, the extension modal for overwriting one.
2. Users or admins can set `nativeToolTemplate.approval.requireExtensionConfirmation: true`
   to turn every `vscodeConfirmation` into the extension modal. The setting has
   `application` scope, so a workspace's `.vscode/settings.json` cannot change it.
3. Org policy (admins):
   - `ChatToolsAutoApprove` = `false`: blocks global auto-approve and the Allow-all/Autopilot bypass.
   - `ChatToolsEligibleForAutoApproval` = `{ "example.native-tool-template/createNote": false }`: forces manual approval of a tool's VS Code confirmation.
   - `AllowedExtensions`: only approved publishers and versions.

   The eligibility key is the tool's *full reference name*. In the current source that is,
   for extension tools, `<publisher>.<name>` from package.json (lowercased) + `/` +
   `toolReferenceName` (or `displayName` if there is none). This format has changed before,
   so verify it on your VS Code baseline: a key that doesn't match is ignored.

## Threat model and mitigations

| Threat | Mitigation in the template |
|---|---|
| Prompt-injected arguments (e.g. path `../../.ssh/x`) | Schema + `normalizeRelativePath` (rejects absolute, drive, `..`, control chars) + host containment re-check in `vscodeWorkspace.ts`. Fixed output folders (`notes/`, `.project-operations/`). |
| Misleading confirmation text (Markdown links, images, fake headings in AI text) | `escapeMarkdown` for all values; `MarkdownString.isTrusted` stays `false`; modal uses plain text. |
| Proposal changes between confirmation and execution | `propose()` re-runs in `invoke`; VS Code confirmation trusted only via the ledger for the identical input; approved value frozen. |
| Bypassed confirmation (auto-approve) | Extension modal / form for anything that must not be auto-approved; setting and policy above. |
| Malformed input from another extension via `lm.invokeTool` | The extension re-validates; it does not rely on VS Code's schema check. |
| Accidental over-reach in a new tool | Lint bans `vscode` in core/tools and `child_process` everywhere; `defineTool` rejects `mutate` without review; manifest test checks manifest/code consistency; `WorkspacePort` has no delete/shell/network. |
| Secrets in prompts or results | The template handles no credentials; tool results contain only operation data; the audit log records tool name, outcome and approval source (plus the error message when execution fails, which may contain a workspace path), not input values. |

The template intentionally contains no shell execution, no arbitrary URL fetching, no
credential handling and no network access. If a derived tool calls an internal API, keep
credentials in the extension (e.g. `SecretStorage` or VS Code authentication providers),
never in tool input, tool results, or `modelDescription`, and give the API client its own
port next to `WorkspacePort` so tools stay testable.

## Known limitations

- `vscodeConfirmation` can be auto-approved by the user or the organization. The extension
  cannot detect whether it was (`ApprovalRecord.source` says *requested*, not *seen*).
- The extension cannot verify that a human (rather than automation) clicked Approve.
- The containment check is lexical. A symlink inside the workspace pointing outside it is not
  detected (`workspace.fs` exposes no `realpath`). Fixed output folders limit the exposure.
- If an admin marks a form or extension-modal tool ineligible for auto-approval, VS Code adds its
  own generic confirmation before `invoke()`, so the user confirms twice. That is safe but noisy;
  use `ChatToolsEligibleForAutoApproval` for `vscodeConfirmation` tools.
- Business rules run in `propose()` and again at submission, but the workspace can still
  change between validation and execution. `writeTextFile(..., { overwrite: false })` refuses
  to replace a file that appeared in between.
