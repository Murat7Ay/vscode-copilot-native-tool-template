# Maintenance: what to do when VS Code changes

This repository is a template. VS Code ships a new version roughly every month, and the
language model / agent area changes fast. This page is the routine for keeping the template
and every extension derived from it working. The AI-agent version of this routine is the
`upgrade-vscode-baseline` skill (`.claude/skills/upgrade-vscode-baseline/SKILL.md`).

## Automatic early warning

`.github/workflows/vscode-canary.yml` runs the integration tests every Monday against
**stable** and **insiders** (and on demand). A red canary means a coming VS Code version
breaks or changes something the template relies on, usually weeks before users get it.

## Every VS Code release (monthly, ~30 minutes)

| # | Task | How |
|---|---|---|
| 1 | Canary green on stable and insiders? | Actions → *VS Code canary*. If red, fix in `src/host/` first. |
| 2 | Read the release notes | https://code.visualstudio.com/updates. Search for: *language model tool*, *confirmation*, *approval*, *auto-approve*, *permission*, *policy*, *finalized API*, *QuickPick*. |
| 3 | Did a relevant proposed API become stable? | `npm view @types/vscode version`, then grep the new `index.d.ts` for `approveCombination`, `ToolProgressStep`, `pastTenseMessage`, `LanguageModelToolInvocationPrepareOptions` fields. See "Watch list" below. |
| 4 | Did approval behavior or setting/policy names change? | Re-check the claims in `docs/APPROVAL-AND-SECURITY.md` against `languageModelToolsService.ts` in the VS Code repo and the ADMX file in the new install (`<install>/policies/VSCode.admx`). Update the doc and `examples/policies/`. |
| 5 | Did the manifest schema change? | `languageModelToolsContribution.ts` in the VS Code repo: new required fields, name patterns, tags rules. Update `test/unit/manifest.test.ts` if needed. |
| 6 | Toolchain updates | `npm outdated`. Keep TypeScript within the range typescript-eslint supports. **Do not** bump `@types/vscode` (it must equal the engines minimum). |
| 7 | Record the outcome | One line in CHANGELOG.md under "Unreleased": "Verified with VS Code 1.NN". |

Nothing to change is the normal result. Do not bump `engines.vscode` just because a new
version exists.

## When the company raises its VS Code baseline

1. Platform team announces the new minimum (oldest VS Code still deployed).
2. In the template: `engines.vscode` → `^1.NN.0` and `@types/vscode` → `1.NN.0` (exact). Update the
   first entry of the CI and canary matrices. `npm install && npm run verify`, integration tests
   on the new minimum and stable.
3. Remove compatibility code that is no longer needed (feature detection in
   `src/host/capabilities.ts` for APIs the new minimum always has).
4. Release a new template version; bump MAJOR if users on the old baseline can no longer install it.

## When a useful API becomes stable

Example: per-argument approval (`approveCombination`) is finalized.

1. If the baseline already includes it: use it in `src/host/registerTools.ts`.
2. If not: add `supportsX()` in `src/host/capabilities.ts`, use the API only when present, keep the
   old behavior otherwise, and test both (`VSCODE_TEST_VERSION` = minimum and stable).
3. If tools need to express something new (e.g. which arguments define the approval scope),
   extend the core contract (`OperationSummary`, `ReviewPolicy`) once, in `src/core/`, never per tool.
4. Document it in COMPATIBILITY.md and APPROVAL-AND-SECURITY.md.

## When something breaks

| Symptom | Likely cause | Where to fix |
|---|---|---|
| Tools missing from the tools picker | manifest validation changed (field required / name pattern) | `package.json`; check the extension host log for "CANNOT register tool" |
| Compile errors after a deliberate engines bump | API signature changed | `src/host/` only |
| Confirmation no longer shown / shown twice | VS Code approval behavior changed | docs + possibly switch a tool to `extensionConfirmation` |
| Form behaves oddly | QuickPick behavior change | `src/host/quickPickForm.ts` |
| Integration test "submitting the pre-filled form" fails | QuickPick command names or item navigation changed | `test/integration/suite.ts` |

## Propagating a template release to derived extensions

```text
template vN ──► copy src/core, src/host, eslint.config.mjs, test/unit/fakes.ts,
                .claude/skills, AGENTS.md, .github/workflows, docs (shared parts)
            ──► npm run verify && npm run test:integration
            ──► bump the derived extension's version, note "based on template vN" in its CHANGELOG
            ──► release through the normal channel (docs/DISTRIBUTION.md)
```

Derived extensions that never modified `src/core/` and `src/host/` get a clean copy. That is
why `AGENTS.md` tells AI agents not to edit them while building tools.

## Watch list (October 2026)

| Item | Status | Why it matters |
|---|---|---|
| `toolInvocationApproveCombination` | proposed | per-argument approval ("allow writing notes/a.md") |
| `chatParticipantPrivate`: `permissionLevel`, `forceConfirmationReason` | proposed | tool could know it runs under Allow-all/Autopilot |
| `toolProgress` | proposed | progress reporting during long `invoke()` |
| `languageModelToolResultAudience` | proposed | results shown to the user but not the model |
| Docs vs source on "generic confirmation for extension tools" | inconsistent | template does not depend on either |
| `chat.tools.eligibleForAutoApproval` key format for extension tools | changed before | policy examples use the current format |
