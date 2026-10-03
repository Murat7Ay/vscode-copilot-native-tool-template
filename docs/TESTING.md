# Testing

```bash
npm test                    # compile + unit tests (Node test runner, no VS Code)
npm run test:integration    # real VS Code extension host; VSCODE_TEST_VERSION=1.99.3|stable|insiders
npm run verify              # lint + unit tests + package
```

## Unit tests (`test/unit`, ~80 tests, < 1 s)

They run against `src/core` and `src/tools` with fakes (`FakeWorkspace`, `FakeGateway` = a
scripted human). No VS Code needed, which is possible only because core and tools don't import it.

| Boundary | What is proven |
|---|---|
| Tool input | valid input passes; every kind of malformed input (wrong type, missing, extra property, enum, length, range, array items) is rejected with a field name; schemas cannot use unenforced keywords |
| Proposal | business validation errors return to the model; normalization (trim, slug, path, tag dedupe) and enrichment (`targetKind`) |
| Approval | approved executes; **declined and cancelled never execute**; VS Code confirmation is trusted only for the input `prepareInvocation` recorded, otherwise escalates to the extension modal; `requireExtensionConfirmation`; a `mutate` tool returning `none` fails closed; forged `Approved` objects are not recognized; approved values are frozen |
| Cancellation | before review → no review, no execution; during review → no execution, for both modal and form |
| Form | initial AI values / defaults / empty; edited values execute instead of AI values; edits are reported; validation failures appear in the form; invalid submissions from a buggy UI are re-validated and refused |
| Tools | each example tool end to end through the pipeline, including "decline leaves the file untouched" |
| Examples | the internal-API example: approved → API called; declined, critical-but-declined and unknown component → API never called |
| AI agent files | skills have valid frontmatter (name = folder, description with "Use when"), mention only existing files; AGENTS.md lists them |
| Manifest | package.json tools = registered tools; required manifest fields; form fields exist in the schema; `mutate` tag; `@types/vscode` = engines minimum; implicit activation |
| Rendering | AI text cannot inject Markdown links or images into confirmations |

## Integration tests (`test/integration`, real VS Code)

`@vscode/test-electron` downloads VS Code and runs `suite.ts` inside its extension host, with a
temporary workspace and other extensions disabled. Tools are called through
`vscode.lm.invokeTool`, the same tool service agent mode uses.

| Verified in a real extension host | |
|---|---|
| All manifest tools are registered with the declared schema, description and tags | ✔ |
| The extension is inactive until the first tool call, then activates (implicit `onLanguageModelTool`) | ✔ |
| A read-only tool with no `confirmationMessages` runs without a prompt | ✔ |
| A prepare tool returns a proposal without a prompt and writes nothing | ✔ |
| Malformed input is rejected; nothing is written | ✔ |
| Form: Esc and token cancellation execute nothing | ✔ |
| Form: submitting through the real QuickPick executes the approved values | ✔ |
| VS Code confirmation path: `prepareInvocation` → ledger → `invoke` across the process boundary | ✔ |
| Extension modal blocks execution even when VS Code's confirmation is auto-approved | ✔ |
| `requireExtensionConfirmation` setting | ✔ |

Important property of the test harness: when running extension tests VS Code **auto-confirms**
its own `confirm()` dialogs and **refuses** `prompt()` dialogs (modal `showWarningMessage`)
(`dialogService.ts`, `skipDialogs`). So the VS Code tool confirmation is auto-approved in
these tests while the extension modal can never be approved. The tests use that to show the
difference, and it is one more reminder that VS Code's confirmation is not a guarantee.

## What still needs a human with Copilot

Not automated, because it needs a signed-in Copilot (or another tool-calling model) and a person:

- The agent actually choosing the tools from `modelDescription` and filling arguments sensibly.
- How the confirmation renders inline in the chat view, and the "Allow" scope options.
- The form appearing while the chat shows "Waiting for your review…".
- Behavior under Allow-all/Autopilot and with the org policies from APPROVAL-AND-SECURITY.md.

Manual checklist (Extension Development Host via F5, agent mode):

1. "#inspectSelection what does this do?" with code selected → no prompt, correct answer.
2. "Create a note called Test" → chat confirmation with path and parameters → Continue → `notes/test.md`.
3. Repeat → the model is told the file exists → "yes, overwrite" → **modal** dialog → Cancel → file unchanged.
4. "Propose a project operation for src" → form with ✨ fields → edit one → Submit → result mentions the edited field.
5. Same, press Esc → the agent is told nothing was executed and does not retry.
6. Switch the permission picker to Allow all → step 2 runs without a prompt; steps 3 and 4 still prompt.
