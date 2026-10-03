import type { ValidationIssue } from './types';

/**
 * Validates tool input against the `inputSchema` declared in package.json.
 *
 * VS Code documents that tool input is validated against the declared schema, but the
 * extension still treats every input as untrusted: other extensions can call
 * `vscode.lm.invokeTool`, schemas evolve, and defense in depth is cheap. This validator
 * supports a deliberately small JSON Schema subset; `findUnsupportedKeywords` (used by the
 * manifest test) fails the build if a schema uses anything else, so a schema can never be
 * silently under-enforced.
 */

export interface JsonSchema {
  type?: 'object' | 'string' | 'number' | 'integer' | 'boolean' | 'array';
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean;
  enum?: (string | number | boolean)[];
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  minimum?: number;
  maximum?: number;
  items?: JsonSchema;
  minItems?: number;
  maxItems?: number;
  default?: unknown;
}

const SUPPORTED_KEYWORDS = new Set([
  'type', 'description', 'properties', 'required', 'additionalProperties', 'enum',
  'minLength', 'maxLength', 'pattern', 'minimum', 'maximum', 'items', 'minItems', 'maxItems', 'default',
]);

export function findUnsupportedKeywords(schema: unknown, path = '$'): string[] {
  if (typeof schema !== 'object' || schema === null) {
    return [];
  }
  const found: string[] = [];
  for (const key of Object.keys(schema)) {
    if (!SUPPORTED_KEYWORDS.has(key)) {
      found.push(`${path}.${key}`);
    }
  }
  const s = schema as JsonSchema;
  for (const [name, child] of Object.entries(s.properties ?? {})) {
    found.push(...findUnsupportedKeywords(child, `${path}.properties.${name}`));
  }
  if (s.items) {
    found.push(...findUnsupportedKeywords(s.items, `${path}.items`));
  }
  return found;
}

export function validateSchema(schema: JsonSchema, value: unknown, path = ''): ValidationIssue[] {
  const field = path || undefined;
  const issue = (message: string): ValidationIssue[] => [{ field, message: path ? `${path}: ${message}` : message }];

  switch (schema.type) {
    case 'object': {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return issue('must be an object');
      }
      const record = value as Record<string, unknown>;
      const issues: ValidationIssue[] = [];
      for (const name of schema.required ?? []) {
        if (record[name] === undefined) {
          issues.push({ field: join(path, name), message: `${join(path, name)}: is required` });
        }
      }
      for (const [name, child] of Object.entries(record)) {
        const childSchema = schema.properties?.[name];
        if (!childSchema) {
          if (schema.additionalProperties === false) {
            issues.push({ field: join(path, name), message: `${join(path, name)}: is not an allowed property` });
          }
          continue;
        }
        if (child !== undefined) {
          issues.push(...validateSchema(childSchema, child, join(path, name)));
        }
      }
      return issues;
    }
    case 'string': {
      if (typeof value !== 'string') {
        return issue('must be a string');
      }
      if (schema.minLength !== undefined && value.length < schema.minLength) {
        return issue(`must be at least ${schema.minLength} characters`);
      }
      if (schema.maxLength !== undefined && value.length > schema.maxLength) {
        return issue(`must be at most ${schema.maxLength} characters`);
      }
      if (schema.pattern !== undefined && !new RegExp(schema.pattern, 'u').test(value)) {
        return issue('has an invalid format');
      }
      return checkEnum(schema, value, issue);
    }
    case 'number':
    case 'integer': {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        return issue('must be a number');
      }
      if (schema.type === 'integer' && !Number.isInteger(value)) {
        return issue('must be an integer');
      }
      if (schema.minimum !== undefined && value < schema.minimum) {
        return issue(`must be >= ${schema.minimum}`);
      }
      if (schema.maximum !== undefined && value > schema.maximum) {
        return issue(`must be <= ${schema.maximum}`);
      }
      return checkEnum(schema, value, issue);
    }
    case 'boolean':
      return typeof value === 'boolean' ? [] : issue('must be a boolean');
    case 'array': {
      if (!Array.isArray(value)) {
        return issue('must be an array');
      }
      if (schema.minItems !== undefined && value.length < schema.minItems) {
        return issue(`must contain at least ${schema.minItems} items`);
      }
      if (schema.maxItems !== undefined && value.length > schema.maxItems) {
        return issue(`must contain at most ${schema.maxItems} items`);
      }
      const itemSchema = schema.items;
      return itemSchema ? value.flatMap((item, i) => validateSchema(itemSchema, item, `${path}[${i}]`)) : [];
    }
    case undefined:
      return checkEnum(schema, value, issue);
  }
}

function checkEnum(schema: JsonSchema, value: unknown, issue: (m: string) => ValidationIssue[]): ValidationIssue[] {
  if (schema.enum && !schema.enum.includes(value as string | number | boolean)) {
    return issue(`must be one of: ${schema.enum.join(', ')}`);
  }
  return [];
}

function join(path: string, name: string): string {
  return path ? `${path}.${name}` : name;
}
