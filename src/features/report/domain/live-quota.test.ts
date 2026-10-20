import { describe, expect, it } from "vitest";
import { admitLiveReport, calendarDayWib, emptyQuota, type QuotaSnapshot } from "./live-quota";

const LIMITS = { perIp: 3, global: 50 };

describe("live report quota", () => {
  it("uses the WIB calendar day", () => {
    expect(calendarDayWib(new Date("2026-10-20T16:30:00.000Z"))).toBe("2026-10-20");
    expect(calendarDayWib(new Date("2026-10-20T17:30:00.000Z"))).toBe("2026-10-21");
  });

  it("allows three starts from one address and rejects the fourth", () => {
    const now = new Date("2026-10-20T03:00:00.000Z");
    let snapshot = emptyQuota();
    for (let n = 0; n < 3; n += 1) {
      const decision = admitLiveReport(snapshot, { ip: "127.0.0.1", now, ...LIMITS });
      expect(decision.allowed).toBe(true);
      snapshot = decision.snapshot;
    }
    const denied = admitLiveReport(snapshot, { ip: "127.0.0.1", now, ...LIMITS });
    expect(denied.allowed).toBe(false);
    expect(denied.message).toMatch(/127\.0\.0\.1/);
    expect(denied.message).toMatch(/3 live reports today/);
    expect(denied.message).toMatch(/featured report/i);
    expect(denied.snapshot.byIp["127.0.0.1"]).toBe(3);
  });

  it("does not spend another address's remaining slots", () => {
    const now = new Date("2026-10-20T03:00:00.000Z");
    const full = fill("10.0.0.1", now, 3);
    const other = admitLiveReport(full, { ip: "10.0.0.2", now, ...LIMITS });
    expect(other.allowed).toBe(true);
    expect(other.snapshot.byIp["10.0.0.1"]).toBe(3);
    expect(other.snapshot.byIp["10.0.0.2"]).toBe(1);
  });

  it("resets the count on the next WIB day", () => {
    const full = fill("127.0.0.1", new Date("2026-10-20T16:30:00.000Z"), 3);
    const nextDay = admitLiveReport(full, {
      ip: "127.0.0.1",
      now: new Date("2026-10-20T17:30:00.000Z"),
      ...LIMITS,
    });
    expect(nextDay.allowed).toBe(true);
    expect(nextDay.snapshot.day).toBe("2026-10-21");
    expect(nextDay.snapshot.total).toBe(1);
  });

  it("rejects a new address once the shared daily limit is full", () => {
    const now = new Date("2026-10-20T03:00:00.000Z");
    const snapshot: QuotaSnapshot = { day: "2026-10-20", byIp: { "10.0.0.9": 50 }, total: 50 };
    const denied = admitLiveReport(snapshot, { ip: "10.0.0.8", now, perIp: 3, global: 50 });
    expect(denied.allowed).toBe(false);
    expect(denied.message).toMatch(/shared daily limit/);
    expect(denied.message).toMatch(/featured report/i);
    expect(denied.snapshot.total).toBe(50);
  });
});

function fill(ip: string, now: Date, count: number): QuotaSnapshot {
  let snapshot = emptyQuota();
  for (let n = 0; n < count; n += 1) {
    const decision = admitLiveReport(snapshot, { ip, now, ...LIMITS });
    snapshot = decision.snapshot;
  }
  return snapshot;
}
