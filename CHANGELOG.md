# Changelog

All notable changes to this template are documented here. Derived extensions should keep
their own changelog and record which template version they are based on.

## 0.1.0

- Proposal → validation → review → execution pipeline (`src/core/pipeline.ts`).
- Review policies: none, VS Code confirmation, extension confirmation, review form.
- QuickPick review form with AI / edited / default / empty field origins.
- Example tools: `template_inspect_selection` (read), `template_prepare_editorconfig` (prepare),
  `template_create_note` (simple confirmation), `template_project_operation` (review form).
- `examples/`: internal-API tool through a port (tested), prompts, enterprise policy and settings examples.
- AI agent support: `AGENTS.md`, `CLAUDE.md`, skills in `.claude/skills/`.
- `docs/MAINTENANCE.md` and a weekly VS Code canary workflow (stable + insiders).
- Verified with VS Code 1.99.3 and 1.140.0.
- Setting `nativeToolTemplate.approval.requireExtensionConfirmation`.
- Unit tests (Node test runner) and integration tests (real VS Code extension host).
