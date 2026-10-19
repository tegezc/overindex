export class BudgetCounter {
  used = 0;

  constructor(
    readonly target: number,
    readonly cap: number,
  ) {}

  tryTake(): boolean {
    if (this.used >= this.cap) return false;
    this.used += 1;
    return true;
  }

  snapshot(): { used: number; target: number; cap: number } {
    return { used: this.used, target: this.target, cap: this.cap };
  }
}
