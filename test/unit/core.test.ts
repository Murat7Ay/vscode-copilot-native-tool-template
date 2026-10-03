import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createFormState, editField, issuesByField, parseFieldText, requiredIssues, summarizeOrigins, type FormSpec } from '../../src/core/form';
import { ConfirmationLedger, stableStringify } from '../../src/core/ledger';
import { findUnsupportedKeywords, validateSchema, type JsonSchema } from '../../src/core/schema';
import { escapeMarkdown, renderSummaryMarkdown } from '../../src/core/summary';
import { normalizeRelativePath, slugify } from '../../src/core/workspace';

describe('schema validation', () => {
  const schema: JsonSchema = {
    type: 'object',
    properties: {
      s: { type: 'string', minLength: 2, maxLength: 4, pattern: '^[a-z]+$' },
      e: { type: 'string', enum: ['x', 'y'] },
      i: { type: 'integer', minimum: 1, maximum: 3 },
      a: { type: 'array', maxItems: 2, items: { type: 'string' } },
      b: { type: 'boolean' },
    },
    required: ['s'],
    additionalProperties: false,
  };

  it('accepts valid input', () => {
    assert.deepEqual(validateSchema(schema, { s: 'abc', e: 'x', i: 2, a: ['q'], b: true }), []);
  });

  it('reports each kind of malformed input with the field name', () => {
    const cases: [unknown, string][] = [
      [[], 'must be an object'],
      [{}, 's: is required'],
      [{ s: 'a' }, 's: must be at least 2 characters'],
      [{ s: 'abcde' }, 's: must be at most 4 characters'],
      [{ s: 'AB' }, 's: has an invalid format'],
      [{ s: 'ab', e: 'z' }, 'e: must be one of: x, y'],
      [{ s: 'ab', i: 1.5 }, 'i: must be an integer'],
      [{ s: 'ab', i: 9 }, 'i: must be <= 3'],
      [{ s: 'ab', a: ['1', '2', '3'] }, 'a: must contain at most 2 items'],
      [{ s: 'ab', a: [1] }, 'a[0]: must be a string'],
      [{ s: 'ab', b: 'yes' }, 'b: must be a boolean'],
      [{ s: 'ab', extra: 1 }, 'extra: is not an allowed property'],
    ];
    for (const [input, message] of cases) {
      assert.deepEqual(validateSchema(schema, input).map((i) => i.message), [message], JSON.stringify(input));
    }
  });

  it('flags schema keywords the validator does not enforce', () => {
    assert.deepEqual(findUnsupportedKeywords(schema), []);
    assert.deepEqual(findUnsupportedKeywords({ type: 'object', properties: { x: { type: 'string', format: 'uri' } }, oneOf: [] }), ['$.oneOf', '$.properties.x.format']);
  });
});

describe('workspace path safety', () => {
  it('normalizes relative paths', () => {
    assert.deepEqual(normalizeRelativePath(' src\\a/./b.ts '), { ok: true, value: 'src/a/b.ts' });
  });

  it('rejects paths that could escape the workspace', () => {
    for (const path of ['', '/etc/passwd', 'C:/Windows', 'c:file', '../x', 'a/../../x', 'a/\u0000', '.']) {
      assert.equal(normalizeRelativePath(path).ok, false, path);
    }
  });

  it('slugifies titles into safe file names', () => {
    assert.equal(slugify('  Release Checklist: Q3 / Ünïcode!  '), 'release-checklist-q3-unicode');
    assert.equal(slugify('../../etc/passwd'), 'etc-passwd');
    assert.equal(slugify('!!!'), '');
  });
});

describe('confirmation rendering', () => {
  it('escapes AI-provided text so it cannot inject links or formatting', () => {
    const md = renderSummaryMarkdown({
      title: 'Create [click me](https://example.invalid) **now**',
      changesState: true,
      resources: [{ path: 'notes/a.md', effect: 'create' }],
      parameters: [['Body', '![img](https://example.invalid/x.png)\n# heading']],
    });
    assert.ok(!md.includes('[click me](https'));
    assert.ok(md.includes('\\[click me\\]\\(https://example\\.invalid\\)'));
    assert.ok(!md.includes('![img]('));
    assert.ok(md.includes('- create: `notes/a.md`'));
    assert.ok(md.includes('changes the workspace'));
  });

  it('escapes every markdown control character', () => {
    assert.equal(escapeMarkdown('a*b_c`d|e<f>'), 'a\\*b\\_c\\`d\\|e\\<f\\>');
  });
});

describe('confirmation ledger', () => {
  it('is single-use, input-specific and key-order independent', () => {
    const ledger = new ConfirmationLedger();
    ledger.record('t', { a: 1, b: 2 });
    assert.equal(ledger.consume('t', { a: 1, b: 3 }), false);
    assert.equal(ledger.consume('other', { a: 1, b: 2 }), false);
    assert.equal(ledger.consume('t', { b: 2, a: 1 }), true);
    assert.equal(ledger.consume('t', { a: 1, b: 2 }), false);
  });

  it('expires entries', () => {
    let now = 0;
    const ledger = new ConfirmationLedger(1000, () => now);
    ledger.record('t', {});
    now = 1001;
    assert.equal(ledger.consume('t', {}), false);
  });

  it('stableStringify ignores key order and undefined values', () => {
    assert.equal(stableStringify({ b: [1, { d: 1, c: undefined }], a: 'x' }), '{"a":"x","b":[1,{"d":1}]}');
  });
});

describe('form model', () => {
  interface F { name: string; mode: string; tags: string[]; timeout: number; note: string }
  const spec: FormSpec<F> = {
    title: 'T',
    fields: [
      { key: 'name', label: 'Name', kind: 'text', required: true },
      { key: 'mode', label: 'Mode', kind: 'choice', options: ['a', 'b'], defaultValue: 'a' },
      { key: 'tags', label: 'Tags', kind: 'list' },
      { key: 'timeout', label: 'Timeout', kind: 'integer', defaultValue: 60 },
      { key: 'note', label: 'Note', kind: 'text', required: true },
    ],
  };

  it('marks initial values as AI suggested, default or empty', () => {
    const state = createFormState(spec, { name: 'ai-name', tags: [], timeout: 5 });
    assert.deepEqual(state.origins, { name: 'ai', mode: 'default', tags: 'empty', timeout: 'ai', note: 'empty' });
    assert.deepEqual(state.values, { name: 'ai-name', mode: 'a', timeout: 5 });
  });

  it('tracks human edits and restores the AI origin when the AI value is chosen again', () => {
    const initial = createFormState(spec, { name: 'ai-name' });
    const edited = editField(initial, 'name', 'human-name');
    assert.equal(edited.origins.name, 'user');
    assert.equal(edited.values.name, 'human-name');
    assert.equal(initial.values.name, 'ai-name', 'state is immutable');
    assert.equal(editField(edited, 'name', 'ai-name').origins.name, 'ai');
    assert.equal(editField(edited, 'name', undefined).origins.name, 'empty');
    assert.deepEqual(summarizeOrigins(edited), { ai: [], user: ['name'], default: ['mode', 'timeout'], empty: ['tags', 'note'] });
  });

  it('reports missing required fields', () => {
    const state = createFormState(spec, { name: 'x' });
    assert.deepEqual(requiredIssues(spec, state.values), [{ field: 'note', message: 'Note is required' }]);
  });

  it('parses typed text per field kind', () => {
    const [name, mode, tags, timeout] = spec.fields;
    assert.deepEqual(parseFieldText(name!, '  hi  '), { ok: true, value: 'hi' });
    assert.deepEqual(parseFieldText(name!, '   '), { ok: true, value: undefined });
    assert.deepEqual(parseFieldText(tags!, 'a, b,, c '), { ok: true, value: ['a', 'b', 'c'] });
    assert.deepEqual(parseFieldText(timeout!, '42'), { ok: true, value: 42 });
    assert.equal(parseFieldText(timeout!, '4.2').ok, false);
    assert.equal(parseFieldText(mode!, 'zzz').ok, false);
  });

  it('groups issues by top-level field', () => {
    const grouped = issuesByField([{ field: 'tags[1]', message: 'bad' }, { field: 'tags', message: 'worse' }, { message: 'global' }]);
    assert.deepEqual([...grouped.entries()], [['tags', ['bad', 'worse']], ['', ['global']]]);
  });
});
