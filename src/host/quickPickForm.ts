import * as vscode from 'vscode';
import { editField, formatFieldValue, issuesByField, parseFieldText, type FieldOrigin, type FieldSpec, type FormState } from '../core/form';
import type { FormReview, FormSession } from '../core/pipeline';
import type { Cancellation } from '../core/types';

/**
 * Renders a FormSession with native QuickPick and InputBox.
 *
 * Why not a Webview: QuickPick/InputBox are stable, keyboard-first, themed, accessible and
 * need no HTML, CSP or message passing. They handle forms of roughly 3-15 scalar fields well.
 * If a tool needs tables, long multi-line text or side-by-side previews, implement another
 * renderer for the same FormSession (see docs/ARCHITECTURE.md); the pipeline does not change.
 */

type Token = Cancellation & Pick<vscode.CancellationToken, 'onCancellationRequested'>;

const ORIGIN: Record<FieldOrigin, { icon: string; text: string }> = {
  ai: { icon: '$(sparkle)', text: 'AI suggested' },
  user: { icon: '$(edit)', text: 'Edited by you' },
  default: { icon: '$(circle-outline)', text: 'Default value' },
  empty: { icon: '$(circle-slash)', text: 'Not set' },
};

type Choice =
  | { action: 'edit'; field: FieldSpec<Record<string, unknown>> }
  | { action: 'submit' | 'reset' | 'cancel' | 'dismiss' };

interface ChoiceItem extends vscode.QuickPickItem {
  choice?: Choice;
}

export async function showQuickPickForm(session: FormSession, token: Token): Promise<FormReview> {
  let state = session.initial;
  let issues = await session.validate(state.values);
  let lastKey: string | undefined;

  for (;;) {
    const choice = await pick(session, state, issues, lastKey, token);
    if (token.isCancellationRequested || choice.action === 'dismiss') {
      return { decision: 'cancelled' };
    }
    switch (choice.action) {
      case 'cancel':
        return { decision: 'declined' };
      case 'submit':
        if (issues.length === 0) {
          return { decision: 'approved', state };
        }
        lastKey = [...issuesByField(issues).keys()][0];
        break;
      case 'reset':
        state = session.initial;
        issues = await session.validate(state.values);
        break;
      case 'edit': {
        lastKey = choice.field.key;
        const edited = await editValue(session.title, choice.field, state, token);
        if (edited.changed) {
          state = editField(state, choice.field.key, edited.value);
          issues = await session.validate(state.values);
        }
        break;
      }
    }
  }
}

function pick(session: FormSession, state: FormState, issues: readonly { field?: string; message: string }[], activeKey: string | undefined, token: Token): Promise<Choice> {
  const byField = issuesByField(issues);
  const fieldItems: ChoiceItem[] = session.fields.map((field) => {
    const origin = ORIGIN[state.origins[field.key] ?? 'empty'];
    const errors = byField.get(field.key);
    const value = formatFieldValue(state.values[field.key]);
    return {
      label: `${errors ? '$(error)' : origin.icon} ${field.label}${field.required ? ' *' : ''}`,
      description: value === '' ? '(empty)' : value,
      detail: [origin.text, field.required ? 'required' : 'optional', ...(errors ?? [])].join(' · '),
      choice: { action: 'edit', field },
    };
  });

  const otherProblems = byField.get('') ?? [];
  const hasEdits = Object.values(state.origins).includes('user');
  const items: ChoiceItem[] = [
    { label: 'Fields', kind: vscode.QuickPickItemKind.Separator },
    ...fieldItems,
    { label: 'Actions', kind: vscode.QuickPickItemKind.Separator },
    {
      label: issues.length === 0 ? '$(check) Submit' : '$(error) Submit',
      detail: issues.length === 0
        ? 'Approve and run with the values above'
        : `Fix ${issues.length} problem(s) first${otherProblems.length ? `: ${otherProblems.join('; ')}` : ''}`,
      choice: { action: 'submit' },
    },
    ...(hasEdits ? [{ label: '$(discard) Reset to AI suggestions', choice: { action: 'reset' } } satisfies ChoiceItem] : []),
    { label: '$(close) Cancel', detail: 'Nothing will be executed', choice: { action: 'cancel' } },
  ];

  return new Promise<Choice>((resolve) => {
    const qp = vscode.window.createQuickPick<ChoiceItem>();
    qp.title = session.title;
    qp.placeholder = 'Select a field to edit, then Submit. Esc cancels.';
    qp.items = items;
    qp.ignoreFocusOut = true;
    qp.matchOnDescription = true;
    qp.matchOnDetail = true;
    const active = fieldItems.find((i) => i.choice?.action === 'edit' && i.choice.field.key === activeKey) ?? fieldItems[0];
    if (active) {
      qp.activeItems = [active];
    }
    let result: Choice = { action: 'dismiss' };
    const disposables = [
      qp.onDidAccept(() => {
        result = qp.selectedItems[0]?.choice ?? result;
        qp.hide();
      }),
      qp.onDidHide(() => {
        disposables.forEach((d) => d.dispose());
        qp.dispose();
        resolve(result);
      }),
      token.onCancellationRequested(() => qp.hide()),
    ];
    qp.show();
  });
}

async function editValue(
  title: string, field: FieldSpec<Record<string, unknown>>, state: FormState, token: Token,
): Promise<{ changed: false } | { changed: true; value: unknown }> {
  const current = state.values[field.key];
  const aiValue = state.aiValues[field.key];
  const aiHint = aiValue !== undefined ? `AI suggested: ${formatFieldValue(aiValue)}` : 'No AI suggestion';

  if (field.kind === 'choice') {
    const options: (vscode.QuickPickItem & { value: unknown })[] = (field.options ?? []).map((option) => ({
      label: option === current ? `$(check) ${option}` : option,
      description: option === aiValue ? 'AI suggested' : undefined,
      value: option,
    }));
    if (!field.required) {
      options.push({ label: '$(circle-slash) Clear', value: undefined });
    }
    const picked = await vscode.window.showQuickPick(options, { title: `${title}: ${field.label}`, placeHolder: aiHint, ignoreFocusOut: true }, token);
    return picked ? { changed: true, value: picked.value } : { changed: false };
  }

  const text = await vscode.window.showInputBox({
    title: `${title}: ${field.label}`,
    value: formatFieldValue(current),
    prompt: [field.help, aiHint].filter(Boolean).join(' — '),
    ignoreFocusOut: true,
    validateInput: (value) => {
      const parsed = parseFieldText(field, value);
      return parsed.ok ? undefined : parsed.message;
    },
  }, token);
  if (text === undefined) {
    return { changed: false };
  }
  const parsed = parseFieldText(field, text);
  return parsed.ok ? { changed: true, value: parsed.value } : { changed: false };
}
