# Example prompts

Run the extension (F5), open a folder in the Extension Development Host, open Chat in
**Agent** mode, and make sure the tools are enabled in the tools picker. Tools can be
referenced explicitly with `#`.

## Read: `#inspectSelection`

Select some code, then:

> Use #inspectSelection and explain what the selected code does.

Expected: no confirmation; the answer refers to the file and lines you selected.

## Prepare: `#prepareEditorConfig`

> Propose an .editorconfig for this repo: 4 spaces, LF line endings. Don't write it yet.

Expected: no confirmation; the agent shows the proposed content and says nothing was written.

## Pattern A, simple confirmation: `#createNote`

> Create a note called "Release checklist" with the steps: bump version, run tests, tag.

Expected: an inline confirmation in chat, titled *Create note "Release checklist"*, listing
`create: notes/release-checklist.md` and the parameters. **Continue** → the file is created.
**Cancel** → the agent is told nothing happened.

> Replace the release checklist note with a shorter version.

Expected: the tool first fails ("already exists … call again with overwrite: true"); the
agent asks you; after you agree, the **extension's modal dialog** appears (warning: the existing
file will be replaced). It appears even if you chose "Always allow" for the tool.

## Pattern B, review form: `#projectOperation`

> Propose a project operation to clean up dead code in src/billing, high priority, tag it backend.

Expected: the chat shows *Waiting for your review: Review project operation*; a QuickPick
form opens with fields marked ✨ AI suggested, default, empty, or ⛔ invalid. Change a field,
then **Submit**. With mode `record`, `.project-operations/<name>.json` is written and the agent
is told which fields you changed. **Esc** or **Cancel** → nothing is written.

## Things to try on purpose

- Ask for a path outside the workspace ("create a note in ../../tmp"): the path is normalized
  into `notes/` or rejected.
- Put Markdown links in a title: the confirmation shows them escaped, not as links.
- Switch the chat permission picker to **Allow all**: `#createNote` (new file) runs without a
  prompt; overwrite and the form still ask you. That is the difference between VS Code's
  confirmation and the extension's own review.
