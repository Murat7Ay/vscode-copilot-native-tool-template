# VS Code version compatibility

## APIs used, and their status

| API | Status | Used for |
|---|---|---|
| `vscode.lm.registerTool`, `LanguageModelTool.invoke` / `prepareInvocation` | Stable | Registering tools |
| `PreparedToolInvocation.invocationMessage` / `confirmationMessages { title, message }` | Stable | VS Code confirmation |
| `LanguageModelToolResult`, `LanguageModelTextPart` | Stable | Results |
| `contributes.languageModelTools` (`name`, `displayName`, `modelDescription`, `userDescription`, `toolReferenceName`, `canBeReferencedInPrompt`, `icon`, `tags`, `inputSchema`) | Stable | Manifest |
| Implicit `onLanguageModelTool:<name>` activation | Stable (generated from the contribution) | Activation |
| `window.createQuickPick`, `showInputBox`, `showQuickPick`, `QuickPickItemKind.Separator`, modal `showWarningMessage` | Stable (long-standing) | Review UI |
| `workspace.fs`, `createOutputChannel(name, { log: true })` | Stable | Workspace port, audit log |

**Not used (proposed, Insiders-only, cannot be published to the Marketplace):**
`toolInvocationApproveCombination` (per-argument approval), `toolProgress`,
`chatParticipantPrivate` (`permissionLevel`, `pastTenseMessage`, `presentation`),
`languageModelToolResultAudience`, `languageModelToolSupportsModel`, `contribLanguageModelToolSets`.
Per-argument approval would be useful, but it is not worth making every derived extension
Insiders-only. If one becomes stable, add it behind a function in `src/host/capabilities.ts` and
use it from `src/host/registerTools.ts` only.

## `engines.vscode`

- Declared: `^1.99.0`. The language model tool API has been stable since 1.95; 1.99 is the first
  stable release where agent mode, the main consumer, was generally available. Set it to the
  **oldest VS Code your company supports**, not the newest.
- `@types/vscode` is pinned to exactly the engines minimum (`1.99.0`). Using a newer API then
  **fails to compile**, which is the cheapest compatibility check there is. A unit test
  enforces that the two stay equal.
- VS Code refuses to install a VSIX, and marketplaces don't offer a version, whose
  `engines.vscode` is newer than the running VS Code. Users on an old VS Code keep the last
  compatible version.
- `src/host/capabilities.ts` handles editors that claim a compatible version but lack the API
  (some forks): the extension logs a warning instead of failing activation.
- CI runs the integration tests on the engines minimum (`1.99.3`) **and** current stable. Add
  your company baseline to the matrix.

## Upgrading 20 derived extensions without touching 20 tool implementations

```text
Company VS Code baseline ─► Template vN ─► derived extension A, B, C …
```

What changes where when VS Code changes:

| Change | Files touched |
|---|---|
| Tool API change (e.g. new confirmation fields) | `src/host/registerTools.ts` |
| Review UI change (e.g. Webview form) | `src/host/quickPickForm.ts` / `reviewGateway.ts` |
| Workspace API change | `src/host/vscodeWorkspace.ts` |
| New approval capability (stable or proposed) | `src/host/capabilities.ts` + `registerTools.ts` |
| Tool behavior | never needed for a VS Code change: `src/tools` cannot import `vscode` |

Recommended process:

1. Derived extensions keep `src/core` and `src/host` **unmodified** and put their own code in
   `src/tools` (and their own ports if needed). That makes template upgrades a mechanical copy.
2. When the template releases a new version, each derived repo copies `src/core`, `src/host`,
   `eslint.config.mjs` and the test fakes, then runs `npm run verify` and the integration tests.
   Use `git merge` from a `template` remote if repos were created from the template with history.
3. If you have many derived extensions, consider extracting `src/core` + `src/host` into an
   internal npm package later. The template does not start that way because a package adds
   publishing infrastructure most teams don't need for their first few tools.

## Behavior that changes between VS Code versions

These are VS Code behaviors, not API contracts, and have changed in the past:

- When a confirmation is shown for extension tools without `confirmationMessages` (the docs
  and current source disagree; see APPROVAL-AND-SECURITY.md).
- Approval scopes, permission levels (Default / Assisted / Allow all / Autopilot) and settings
  names (`chat.tools.global.autoApprove`, `chat.tools.eligibleForAutoApproval`).
- The key format of `chat.tools.eligibleForAutoApproval` for extension tools.

The template copes by not depending on any of them for its guarantees: anything that must
always have a human in the loop uses extension-owned UI (`extensionConfirmation` or `form`).
