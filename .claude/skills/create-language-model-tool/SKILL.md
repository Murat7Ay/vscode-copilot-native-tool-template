---
name: create-language-model-tool
description: Add a new native VS Code Language Model Tool to this template the safe way (manifest entry, propose, review policy, execute, tests). Use when the user asks to create, add or scaffold a tool, e.g. "add a tool that generates X", "make a tool that calls our API", "create a service definition tool".
---

# Create a language model tool

Follow these steps in order. Read `AGENTS.md` first if you have not. Reference
implementations: `src/tools/inspectSelection.ts` (read), `src/tools/prepareEditorConfig.ts`
(prepare), `src/tools/createNote.ts` (simple confirmation), `src/tools/projectOperation.ts` (form).

## 1. Classify the tool

Ask, or infer from the request:

| Question | Answer → choice |
|---|---|
| Does it only read? | category `read`, review `none` |
| Does it compute something without changing anything? | category `prepare`, review `none`; return the proposal as data |
| Does it change files, configuration or any external system? | category `mutate`; continue below |
| Few parameters, low impact, easy to undo? | review `vscodeConfirmation` |
| Must never be auto-approved (production systems, irreversible, money, data deletion)? | review `extensionConfirmation` |
| Many parameters a human should check or complete? | review `form` |
| Riskier for some inputs (overwrite, production target)? | review function `(p) => …` returning a stricter policy for those |

If the tool needs something other than workspace files (HTTP API, database, CLI), plan a
**port**: an interface the tool depends on, a host implementation, and a test fake. Never use
`child_process`, never put credentials in tool input or results.

## 2. Declare it in package.json

Add an entry to `contributes.languageModelTools`:

```jsonc
{
  "name": "<prefix>_<verb>_<noun>",          // ^[\w-]+$, not copilot_/vscode_; this is API, don't rename later
  "displayName": "Verb Noun",
  "toolReferenceName": "verbNoun",            // #verbNoun in chat
  "canBeReferencedInPrompt": true,
  "icon": "$(codicon-name)",
  "userDescription": "One line for humans.",
  "modelDescription": "For the model: what it does, when to use it, what each field means, what happens on decline (\"do not retry unless the user asks\").",
  "tags": ["<prefix>", "<read|prepare|mutate|form>"],
  "inputSchema": { "type": "object", "properties": { }, "required": [ ], "additionalProperties": false }
}
```

Schema keywords allowed: `type properties required additionalProperties enum minLength
maxLength pattern minimum maximum items minItems maxItems description default`. For form
tools, make fields optional so the AI can send a partial proposal; the form enforces `required`.

## 3. Write `src/tools/<camelName>.ts`

```ts
import { defineTool } from '../core/tool';
import { invalid, valid } from '../core/types';
import { normalizeRelativePath } from '../core/workspace';

export interface XInput { /* mirrors inputSchema; all optional for form tools */ }
interface XProposal { /* validated, normalized, enriched */ }

export const xTool = defineTool<XInput, XProposal>({
  name: '<prefix>_<verb>_<noun>',          // identical to package.json
  category: 'mutate',
  async propose(input, { workspace }) {     // NO side effects
    // validate business rules → invalid({ field, message }) with a message telling the model how to fix it
    // normalize (trim, normalizeRelativePath, lowercase) and enrich (workspace.stat …)
    return valid({ /* proposal */ });
  },
  describe: (p) => ({                        // not needed for form tools
    title: 'Verb noun "name"',
    changesState: true,
    resources: [{ path: 'folder/file', effect: 'create' }],
    parameters: [['Label', 'value']],
  }),
  review: { kind: 'vscodeConfirmation' },
  async execute({ proposal, approval }, { workspace }) {
    // do exactly what was approved; return a short message and data, no secrets
    return { message: 'Did X.', data: { } };
  },
});
```

Form review:

```ts
review: {
  kind: 'form',
  form: {
    title: 'Review <thing>',
    fields: [
      { key: 'name', label: 'Name', kind: 'text', required: true, help: '…' },
      { key: 'mode', label: 'Mode', kind: 'choice', options: ['a', 'b'], defaultValue: 'a' },
      { key: 'tags', label: 'Tags', kind: 'list' },
      { key: 'timeoutSeconds', label: 'Timeout', kind: 'integer', defaultValue: 60 },
    ],
  },
},
```

Every field `key` must exist in `inputSchema.properties`.

## 4. Register it

Add the tool to the array in `src/tools/index.ts`.

## 5. Test it

Add tests to `test/unit/` (copy the style of `test/unit/tools.test.ts`; load the schema from
package.json with `schemaOf`). Minimum:

- valid input → expected proposal / summary (`prepareTool`)
- malformed input → `status: 'invalid'`
- business rule violation → `status: 'invalid'` with a useful message
- approved → expected effect in `FakeWorkspace` (or your port fake)
- **declined and cancelled → no effect** (assert the fake was not written/called)
- form tools: AI values pre-filled, an edit changes what executes, invalid AI value shown as an issue

## 6. Verify

```bash
npm run verify
npm run test:integration
```

`test/unit/manifest.test.ts` fails if the manifest and code disagree. Fix the cause, never the test.

## 7. Document

Update README.md (tool list / example prompts) and CHANGELOG.md. A new tool is a MINOR version bump.
