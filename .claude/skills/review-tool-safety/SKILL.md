---
name: review-tool-safety
description: Review a new or changed language model tool against this template's approval and security rules (proposal vs execution, review policy, input validation, no side effects in propose, no secrets). Use when asked to review a tool, a pull request touching src/tools, src/core, src/host or contributes.languageModelTools, or before releasing a version.
---

# Review a tool for safety

Report findings as a list: file:line, what is wrong, the concrete failure scenario, and the
fix. Do not approve on "it compiles". Background: `docs/APPROVAL-AND-SECURITY.md`.

## Checklist

### Classification and review
- [ ] `category` is honest. Anything that writes files, changes configuration or calls a
      system that changes state is `mutate`, even if "small".
- [ ] `mutate` tools use a review policy; `none` only on `read` / `prepare`.
- [ ] Irreversible or high-impact operations (production, deletion, money, external writes)
      use `extensionConfirmation` or `form`, not only `vscodeConfirmation`, because VS Code
      confirmations can be auto-approved by user or organization settings.
- [ ] Review functions return the *stricter* policy for riskier inputs (overwrite, prod).
- [ ] The tool carries the `mutate` tag in package.json if it is `mutate`.

### The proposal/execution boundary
- [ ] `execute()` is never called outside `src/core/pipeline.ts`; no hand-built `Approved` objects.
- [ ] `propose()` and `describe()` have no side effects (no writes, no API calls that change state,
      no prompts). Reads are fine.
- [ ] `execute()` does only what `describe()` / the form showed. Nothing extra, no different target.
- [ ] `execute()` uses only the approved `proposal`, not re-read AI input or mutable shared state.

### Input handling
- [ ] Schema is strict: `additionalProperties: false`, lengths, enums, ranges.
- [ ] Paths go through `normalizeRelativePath`; writes stay in a fixed folder; no absolute paths.
- [ ] Identifiers that become file names are validated (pattern) or slugified.
- [ ] Error messages from `propose()` tell the model how to fix the input.
- [ ] No string from input is used as a command, URL, query or code without strict validation.

### Confirmation quality
- [ ] `describe()` says what happens, which resources (with effect create/update/overwrite),
      key parameters, and `changesState` correctly.
- [ ] Warnings for destructive effects ("The existing file will be replaced").

### Secrets and data
- [ ] No credentials, tokens or internal URLs in `modelDescription`, tool input or results.
- [ ] Results contain only what the model needs. Large or sensitive data is truncated or omitted.
- [ ] Credentials, if any, come from a host-side port (SecretStorage / authentication API).

### Template boundaries
- [ ] No `vscode` import in `src/core` or `src/tools` (lint).
- [ ] No `child_process`, `eval`, `new Function`, proposed APIs.
- [ ] `src/core` / `src/host` unchanged, or the change is a deliberate, documented template change.

### Tests
- [ ] Tests prove declined and cancelled reviews cause **no** effect.
- [ ] Malformed and business-invalid inputs are tested.
- [ ] `npm run verify` and `npm run test:integration` pass.
