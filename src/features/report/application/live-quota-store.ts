import { admitLiveReport, emptyQuota, type LiveQuotaDecision } from "../domain/live-quota";

let snapshot = emptyQuota();

export function takeLiveSlot(ip: string, limits: { perIp: number; global: number }, now = new Date()): LiveQuotaDecision {
  const decision = admitLiveReport(snapshot, { ip, now, perIp: limits.perIp, global: limits.global });
  snapshot = decision.snapshot;
  return decision;
}
