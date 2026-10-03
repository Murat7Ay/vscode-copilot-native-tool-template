import type { OperationSummary, ResourceEffect } from './types';

/**
 * Renders an OperationSummary for humans. Every value may contain AI-generated text, so it is
 * escaped: a proposal must not be able to inject links, images or formatting into the
 * confirmation that asks the human to approve it.
 */

const EFFECT_LABEL: Record<ResourceEffect, string> = {
  read: 'read',
  create: 'create',
  update: 'update',
  overwrite: 'OVERWRITE',
  none: 'no change',
};

export function escapeMarkdown(text: string): string {
  return text
    .replace(/[\r\n]+/g, ' ')
    .replace(/[\\`*_{}[\]()#+\-.!|<>~]/g, (c) => `\\${c}`);
}

export function renderSummaryMarkdown(summary: OperationSummary): string {
  const lines: string[] = [];
  lines.push(`**${escapeMarkdown(summary.title)}**`, '');
  for (const warning of summary.warnings ?? []) {
    lines.push(`$(warning) ${escapeMarkdown(warning)}`, '');
  }
  if (summary.resources.length > 0) {
    lines.push('Affected resources:', '');
    for (const r of summary.resources) {
      lines.push(`- ${EFFECT_LABEL[r.effect]}: \`${r.path.replace(/`/g, "'")}\``);
    }
    lines.push('');
  }
  if (summary.parameters.length > 0) {
    lines.push('| Parameter | Value |', '|---|---|');
    for (const [label, value] of summary.parameters) {
      lines.push(`| ${escapeMarkdown(label)} | ${escapeMarkdown(truncate(value, 200))} |`);
    }
    lines.push('');
  }
  lines.push(summary.changesState ? '_This operation changes the workspace._' : '_This operation does not change anything._');
  return lines.join('\n');
}

/** Plain-text rendering for native modal dialogs, which do not render Markdown. */
export function renderSummaryPlain(summary: OperationSummary): string {
  const lines: string[] = [];
  for (const warning of summary.warnings ?? []) {
    lines.push(`⚠ ${warning}`);
  }
  for (const r of summary.resources) {
    lines.push(`${EFFECT_LABEL[r.effect]}: ${r.path}`);
  }
  for (const [label, value] of summary.parameters) {
    lines.push(`${label}: ${truncate(value.replace(/[\r\n]+/g, ' '), 200)}`);
  }
  lines.push(summary.changesState ? 'This operation changes the workspace.' : 'This operation does not change anything.');
  return lines.join('\n');
}

export function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}
