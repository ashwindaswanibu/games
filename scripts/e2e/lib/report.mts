/**
 * A tiny test reporter: named checks grouped by section, printed as they run. A failed check is
 * recorded and the run continues, so one broken game doesn't hide the state of the others; a thrown
 * error ends its section (see `runSection`).
 */
export class Report {
  private readonly failures = new Map<string, string[]>();
  private readonly order: string[] = [];
  private current = "setup";

  section(name: string): void {
    this.current = name;
    if (!this.order.includes(name)) this.order.push(name);
    console.log(`\n▶ ${name}`);
  }

  /** Records one check; returns `ok` so callers can branch on it. */
  check(name: string, ok: boolean, detail?: unknown): boolean {
    if (!ok) {
      const line = detail === undefined ? name : `${name}: ${typeof detail === "string" ? detail : JSON.stringify(detail)}`;
      this.failuresIn(this.current).push(line);
    }
    console.log(`  ${ok ? "✓" : "✗"} ${name}${!ok && detail !== undefined ? ` (${typeof detail === "string" ? detail : JSON.stringify(detail)})` : ""}`);
    return ok;
  }

  equal<T>(name: string, actual: T, expected: T): boolean {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    return this.check(name, ok, ok ? undefined : { expected, actual });
  }

  note(text: string): void {
    console.log(`  · ${text}`);
  }

  /** Runs a section; an exception fails it (with the message) instead of aborting the run. */
  async runSection(name: string, body: () => Promise<void>): Promise<void> {
    this.section(name);
    try {
      await body();
    } catch (error) {
      const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
      this.check("section completed without an error", false, message.split("\n").slice(0, 6).join(" | "));
    }
  }

  failuresIn(section: string): string[] {
    let list = this.failures.get(section);
    if (!list) {
      list = [];
      this.failures.set(section, list);
    }
    return list;
  }

  get failed(): boolean {
    return [...this.failures.values()].some((list) => list.length > 0);
  }

  summary(): string {
    const lines = this.order.map((name) => {
      const failures = this.failures.get(name) ?? [];
      return failures.length === 0 ? `  ✓ ${name}` : `  ✗ ${name}\n${failures.map((f) => `      - ${f}`).join("\n")}`;
    });
    return `\nSummary\n${lines.join("\n")}\n\n${this.failed ? "FAILED" : "PASSED"}`;
  }
}
