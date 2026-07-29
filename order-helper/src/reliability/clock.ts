export interface Clock {
  nowMs(): number;
}

export class SystemClock implements Clock {
  public nowMs(): number {
    return Date.now();
  }
}

export class ManualClock implements Clock {
  private currentMs: number;

  public constructor(initialMs = 0) {
    assertTimestamp(initialMs, "initialMs");
    this.currentMs = initialMs;
  }

  public nowMs(): number {
    return this.currentMs;
  }

  public set(nowMs: number): void {
    assertTimestamp(nowMs, "nowMs");
    this.currentMs = nowMs;
  }

  public advance(deltaMs: number): void {
    if (!Number.isSafeInteger(deltaMs) || deltaMs < 0) {
      throw new RangeError("deltaMs must be a non-negative safe integer");
    }
    this.set(this.currentMs + deltaMs);
  }
}

export function assertTimestamp(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer`);
  }
}
