/** Limite par adresse IP (fenêtre glissante d'une minute) et budget quotidien global. */
export class Limiter {
  private hits = new Map<string, number[]>();
  private day = today();
  private spent = 0;

  constructor(
    private perMinute: number,
    private dailyBudgetUsd: number
  ) {}

  checkRate(ip: string): { ok: true } | { ok: false; retryAfter: number } {
    const now = Date.now();
    const list = (this.hits.get(ip) ?? []).filter((t) => now - t < 60_000);
    if (list.length >= this.perMinute) {
      return { ok: false, retryAfter: Math.ceil((60_000 - (now - list[0])) / 1000) };
    }
    list.push(now);
    this.hits.set(ip, list);
    if (this.hits.size > 5000) this.hits.clear();
    return { ok: true };
  }

  private roll() {
    const d = today();
    if (d !== this.day) {
      this.day = d;
      this.spent = 0;
    }
  }

  budgetLeft(): boolean {
    this.roll();
    return this.dailyBudgetUsd <= 0 || this.spent < this.dailyBudgetUsd;
  }

  record(costUsd: number) {
    this.roll();
    this.spent += costUsd;
  }

  spentToday() {
    this.roll();
    return Math.round(this.spent * 10000) / 10000;
  }

  get budget() {
    return this.dailyBudgetUsd;
  }
}

function today() {
  return new Date().toISOString().slice(0, 10);
}
