export interface CooldownState {
  count: number;
  until: number;
}

export class CooldownManager {
  private readonly states = new Map<string, CooldownState>();

  constructor(
    private readonly baseSeconds = 60,
    private readonly multiplier = 5,
    private readonly maxSeconds = 3600,
    private readonly billingBaseHours = 5,
    private readonly billingMaxHours = 24
  ) {}

  isCooling(profileName: string): boolean {
    const state = this.states.get(profileName);
    if (!state) return false;
    return Date.now() < state.until;
  }

  markFailure(profileName: string, reason: 'rate_limit' | 'billing'): void {
    const state = this.states.get(profileName) ?? { count: 0, until: 0 };
    state.count += 1;

    if (reason === 'billing') {
      const hours = Math.min(
        this.billingBaseHours * Math.pow(2, state.count - 1),
        this.billingMaxHours
      );
      state.until = Date.now() + hours * 60 * 60 * 1000;
    } else {
      const seconds = Math.min(
        this.baseSeconds * Math.pow(this.multiplier, state.count - 1),
        this.maxSeconds
      );
      state.until = Date.now() + seconds * 1000;
    }

    this.states.set(profileName, state);
  }

  clear(profileName: string): void {
    this.states.delete(profileName);
  }
}
