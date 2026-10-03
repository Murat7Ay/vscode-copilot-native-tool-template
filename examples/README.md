# Examples

| Path | What it shows |
|---|---|
| [prompts.md](prompts.md) | Agent-mode prompts for each example tool and what should happen |
| [tools/createTicket.ts](tools/createTicket.ts) | A tool that calls an internal system through a **port** (no HTTP, no credentials in the tool). Stricter review for critical tickets. Tested in `test/unit/examples.test.ts`, not registered in the extension. |
| [policies/windows-policies.ps1](policies/windows-policies.ps1) | Registry values that GPO/Intune would set: disable auto-approve bypass, force manual approval of a tool, allow-list pinned versions, manual VS Code updates |
| [policies/linux-policy.json](policies/linux-policy.json) | The same as `/etc/vscode/policy.json` |
| [settings/user-settings.jsonc](settings/user-settings.jsonc) | User settings for "always ask a human" |

Policy names and value types were checked against the ADMX template shipped with VS Code 1.140
(`<install>/policies/VSCode.admx`). Object-valued policies (`AllowedExtensions`,
`ChatToolsEligibleForAutoApproval`) are `multiText` there, i.e. a JSON **string**. Verify the
Linux `policy.json` format against the sample shipped with your VS Code version
(`resources/app/policies`) before rolling it out.

The four tools that are actually registered live in `src/tools/`:

| Tool | Category | Review |
|---|---|---|
| `template_inspect_selection` | read | none |
| `template_prepare_editorconfig` | prepare | none (writes nothing) |
| `template_create_note` | mutate | VS Code confirmation; extension modal for overwrite |
| `template_project_operation` | mutate | review form |
