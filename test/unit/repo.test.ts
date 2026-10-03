import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, it } from 'node:test';

/**
 * Keeps the AI-agent files usable: skills must follow the Agent Skills format VS Code and
 * Claude Code load, and every repository path they mention must exist.
 */

const root = resolve(__dirname, '../../..');
const skillsDir = join(root, '.claude', 'skills');
const skills = readdirSync(skillsDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);

function frontmatter(text: string): Record<string, string> {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  assert.ok(match, 'missing frontmatter');
  const fields: Record<string, string> = {};
  for (const line of (match[1] ?? '').split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i > 0) {
      fields[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
  }
  return fields;
}

describe('AI agent files', () => {
  it('has the expected skills', () => {
    assert.deepEqual(skills.sort(), ['create-language-model-tool', 'review-tool-safety', 'upgrade-vscode-baseline']);
  });

  for (const skill of skills) {
    it(`skill '${skill}' has valid frontmatter`, () => {
      const fields = frontmatter(readFileSync(join(skillsDir, skill, 'SKILL.md'), 'utf8'));
      assert.equal(fields.name, skill, 'name must match the folder');
      assert.match(fields.name ?? '', /^[a-z0-9-]{1,64}$/);
      assert.ok(fields.description && fields.description.length <= 1024, 'description required, max 1024 chars');
      assert.match(fields.description ?? '', /Use (when|for)/, 'description should say when to use the skill');
    });

    it(`skill '${skill}' only references files that exist`, () => {
      const text = readFileSync(join(skillsDir, skill, 'SKILL.md'), 'utf8');
      const paths = [...text.matchAll(/`((?:src|test|docs|examples|\.github|\.claude)\/[\w./-]+\.(?:ts|md|yml|json|mjs))`/g)].map((m) => m[1]!);
      for (const path of paths) {
        assert.ok(existsSync(join(root, path)), `${skill} mentions missing file ${path}`);
      }
    });
  }

  it('AGENTS.md lists every skill and CLAUDE.md imports it', () => {
    const agents = readFileSync(join(root, 'AGENTS.md'), 'utf8');
    for (const skill of skills) {
      assert.ok(agents.includes(`\`${skill}\``), `AGENTS.md does not mention ${skill}`);
    }
    assert.equal(readFileSync(join(root, 'CLAUDE.md'), 'utf8').trim(), '@AGENTS.md');
  });
});
