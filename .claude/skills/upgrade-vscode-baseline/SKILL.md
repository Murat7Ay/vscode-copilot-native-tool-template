---
name: upgrade-vscode-baseline
description: Check and adapt this extension when VS Code releases a new version, when the company raises its VS Code baseline, or when a tool/approval API changes or a proposed API becomes stable. Use for "VS Code updated", "bump engines", "check compatibility with VS Code 1.x", "is approveCombination stable yet", or the monthly maintenance check.
---

# Upgrade / verify against a new VS Code version

Full background: `docs/MAINTENANCE.md` and `docs/COMPATIBILITY.md`. Report what you checked,
what changed, and what you changed. Never claim "compatible" without running the integration tests.

## A. Every new VS Code release (no baseline change)

1. Run the integration tests on the new version and on Insiders:
   ```bash
   VSCODE_TEST_VERSION=stable npm run test:integration
   VSCODE_TEST_VERSION=insiders npm run test:integration
   ```
2. Read the release notes (https://code.visualstudio.com/updates) for: language model tools,
   tool confirmation/approval, `chat.tools.*` settings, permission levels, enterprise policies,
   "finalized API", QuickPick/InputBox changes.
3. Check whether a relevant proposed API became stable. Compare the newest `@types/vscode`
   with the template's list in docs/COMPATIBILITY.md:
   ```bash
   npm view @types/vscode version
   npm pack @types/vscode@latest && tar xzf types-vscode-*.tgz
   grep -n "approveCombination\|ToolProgressStep\|pastTenseMessage\|LanguageModelToolInvocationPrepareOptions" vscode/index.d.ts
   ```
4. Update docs/APPROVAL-AND-SECURITY.md if approval behavior or setting/policy names changed.
   Behavior claims there come from VS Code source (not this repo); re-check
   https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/chat/browser/tools/languageModelToolsService.ts
   (search for `confirmationMessages`, `isToolEligibleForAutoApproval`, `shouldAutoConfirm`)
   and the ADMX file in the new install (`<install>/policies/VSCode.admx`) for policy names.
5. Do NOT bump `engines.vscode` or `@types/vscode` just because a new version exists.

## B. Raising the minimum supported VS Code (company baseline moved)

1. Confirm the company baseline (oldest VS Code still deployed) with the user.
2. Set both to the new minimum, exactly:
   - `package.json` → `"engines": { "vscode": "^1.NN.0" }`
   - `package.json` → `"@types/vscode": "1.NN.0"` (exact, no caret)
3. `npm install && npm run verify`; fix type errors in `src/host/` only.
4. Update the CI matrix in `.github/workflows/ci.yml` and `vscode-canary.yml` (first entry = new minimum patch release).
5. `VSCODE_TEST_VERSION=1.NN.x npm run test:integration` and on `stable`.
6. Update README "Requirements", docs/COMPATIBILITY.md, CHANGELOG.md. Raising the minimum beyond
   what some users run is a MAJOR version bump.

## C. Adopting a newly stable API (e.g. per-argument approval)

1. Only after it is in stable `vscode.d.ts` *and* the baseline includes it (else see step 2).
2. If the baseline is older: add feature detection in `src/host/capabilities.ts`
   (`supportsX()`), use it from `src/host/registerTools.ts` only, keep the old path working.
3. Never touch `src/tools/` for a VS Code API change; if a tool would need to, extend the core
   contract (`ReviewPolicy`, `OperationSummary`) instead and document it.
4. Add an integration test for the new path, and a unit test for the core change.

## D. Propagate to derived extensions

Template release → each derived repo copies `src/core`, `src/host`, `eslint.config.mjs`,
`test/unit/fakes.ts`, `.claude/skills`, `AGENTS.md`, CI workflows; runs `npm run verify` and
the integration tests; bumps its version; records the template version in its CHANGELOG.
