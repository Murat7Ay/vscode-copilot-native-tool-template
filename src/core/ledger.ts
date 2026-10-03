/**
 * Remembers which inputs VS Code was asked to confirm.
 *
 * `prepareInvocation` decides whether to request VS Code's confirmation, but it runs before
 * `invoke` and the workspace can change in between (or `prepareInvocation` may have found the
 * proposal invalid and requested nothing). The pipeline therefore only trusts the VS Code
 * confirmation for an input that was recorded here; otherwise it escalates to the extension's
 * own confirmation. Entries are counted, single-use and expire.
 */
export class ConfirmationLedger {
  private readonly entries = new Map<string, number[]>();

  constructor(
    private readonly ttlMs = 15 * 60 * 1000,
    private readonly now: () => number = Date.now,
  ) {}

  record(toolName: string, input: unknown): void {
    const key = ledgerKey(toolName, input);
    this.prune();
    this.entries.set(key, [...(this.entries.get(key) ?? []), this.now()]);
  }

  /** Returns true (and forgets one entry) if a confirmation was requested for exactly this input. */
  consume(toolName: string, input: unknown): boolean {
    const key = ledgerKey(toolName, input);
    this.prune();
    const times = this.entries.get(key);
    if (!times || times.length === 0) {
      return false;
    }
    times.shift();
    if (times.length === 0) {
      this.entries.delete(key);
    }
    return true;
  }

  private prune(): void {
    const cutoff = this.now() - this.ttlMs;
    for (const [key, times] of this.entries) {
      const fresh = times.filter((t) => t >= cutoff);
      if (fresh.length === 0) {
        this.entries.delete(key);
      } else {
        this.entries.set(key, fresh);
      }
    }
  }
}

function ledgerKey(toolName: string, input: unknown): string {
  return `${toolName}\u0000${stableStringify(input)}`;
}

/** JSON.stringify with sorted object keys, so equal inputs produce equal keys. */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}
