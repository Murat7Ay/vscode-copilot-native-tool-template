# Creating a tool from this template

## Files you change

| File | Change |
|---|---|
| `package.json` | `name`, `displayName`, `description`, `publisher`, `version`, `repository`; the settings section key `nativeToolTemplate.*`; your `contributes.languageModelTools` entries. |
| `src/extension.ts` | `SETTINGS_SECTION` (must match package.json) and the output channel name. |
| `src/tools/<yourTool>.ts` | One file per tool. |
| `src/tools/index.ts` | Add your tool to the list. |
| `test/unit/<yourTool>.test.ts` | Tests for propose / review / execute. |
| `README.md`, `CHANGELOG.md`, `LICENSE` | Your extension's documentation. |
| `.github/workflows/ci.yml` | Add your company VS Code baseline to the matrix. |

Delete the four example tools in `src/tools/` (and their tests) when you no longer need them as
references. AI agents: the `create-language-model-tool` skill walks through these steps.
Do **not** change `src/core` or `src/host` unless you are deliberately changing the template.
Keeping them unmodified is what makes template upgrades cheap (see COMPATIBILITY.md).

## Step 1: metadata

Pick a stable, company-wide `publisher` (see DISTRIBUTION.md) and a tool name prefix, e.g.
`acme_`. Tool names are API: agents, prompts and admin policies refer to them.

## Step 2: declare the tool in package.json

```jsonc
{
  "name": "acme_create_widget",            // <prefix>_<verb>_<noun>; not copilot_/vscode_
  "displayName": "Create Widget",
  "toolReferenceName": "createWidget",     // used as #createWidget in chat
  "canBeReferencedInPrompt": true,
  "icon": "$(symbol-class)",
  "userDescription": "Creates a widget definition after you review it.",
  "modelDescription": "What it does, when to use it, what each field means, what happens on decline. Write for the model; no secrets.",
  "tags": ["acme", "mutate"],              // tag 'mutate' on tools that change state (test-enforced)
  "inputSchema": { "type": "object", "properties": { … }, "required": [ … ], "additionalProperties": false }
}
```

The schema is the single source of truth: the extension reads it at runtime and re-validates
every input. Supported keywords: `type`, `properties`, `required`, `additionalProperties`,
`enum`, `minLength`, `maxLength`, `pattern`, `minimum`, `maximum`, `items`, `minItems`,
`maxItems`, `description`, `default`. A test fails if you use anything else.

For form tools, keep fields optional in the schema so the AI can send a partial proposal; the
form enforces `required`.

## Step 3: implement proposal validation

```ts
export interface CreateWidgetInput { name: string; size?: number }
interface WidgetProposal { name: string; size: number; path: string }

export const createWidgetTool = defineTool<CreateWidgetInput, WidgetProposal>({
  name: 'acme_create_widget',
  category: 'mutate',
  async propose(input, { workspace }) {          // no side effects: also runs in prepareInvocation
    const name = input.name.trim();
    if (!/^[A-Z]\w+$/.test(name)) return invalid({ field: 'name', message: 'Name must be PascalCase' });
    const path = `widgets/${name}.json`;
    if (await workspace.stat(path)) return invalid({ field: 'name', message: `${path} already exists` });
    return valid({ name, size: input.size ?? 1, path });
  },
  describe: (p) => ({
    title: `Create widget "${p.name}"`,
    changesState: true,
    resources: [{ path: p.path, effect: 'create' }],
    parameters: [['Size', String(p.size)]],
  }),
  // Step 4
  review: { kind: 'vscodeConfirmation' },
  // Step 5
  async execute({ proposal }, { workspace }) {
    await workspace.writeTextFile(proposal.path, JSON.stringify(proposal, null, 2), { overwrite: false });
    return { message: `Created ${proposal.path}.`, data: { path: proposal.path } };
  },
});
```

Error messages from `propose` go back to the model, so say how to fix the input.

## Step 4: choose the review

| Policy | Use when | Bypassable by VS Code auto-approve? |
|---|---|---|
| `{ kind: 'none' }` | `read` / `prepare` tools only | n/a |
| `{ kind: 'vscodeConfirmation' }` | Low-impact, easily reversible changes | Yes (user/org setting) |
| `{ kind: 'extensionConfirmation' }` | Must always be confirmed; few parameters | No |
| `{ kind: 'form', form: { title, fields } }` | Many parameters; the human should review and edit | No |
| `(proposal) => …` | Choose per proposal, e.g. stricter for overwrite or production targets | depends on the result |

Form fields: `{ key, label, kind: 'text' | 'choice' | 'integer' | 'list', required?, options?, defaultValue?, help? }`.
Every `key` must exist in `inputSchema.properties` (test-enforced).

## Step 5: implement execution

`execute` receives `Approved<TProposal>`: the frozen, human-approved proposal and the
`ApprovalRecord` (source, time, and for forms which fields the human edited). Keep it focused
on doing the work. Return a short message and data for the model, with no secrets.

If execution needs something other than workspace files (an internal HTTP API, a CLI on the
PATH, a database), add a **port**: an interface in your tool folder, a VS Code- or
Node-backed implementation wired in `src/extension.ts`, and a fake in tests. Do not reach for
`child_process` (lint-banned), and do not pass credentials through tool input.

## Step 6: verify

```bash
npm run verify              # lint + unit tests + package
npm run test:integration    # real VS Code
```

Then try it with agent mode in an Extension Development Host (F5), including declining and
cancelling.
