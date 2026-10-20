export type QuotaSnapshot = {
  day: string;
  byIp: Readonly<Record<string, number>>;
  total: number;
};

export type LiveQuotaInput = {
  ip: string;
  now: Date;
  perIp: number;
  global: number;
};

export type LiveQuotaDecision = {
  snapshot: QuotaSnapshot;
  allowed: boolean;
  message?: string;
};

const EMPTY: QuotaSnapshot = { day: "", byIp: {}, total: 0 };

/** Calendar day in WIB (UTC+7), the project clock. */
export function calendarDayWib(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function emptyQuota(): QuotaSnapshot {
  return EMPTY;
}

export function admitLiveReport(snapshot: QuotaSnapshot, input: LiveQuotaInput): LiveQuotaDecision {
  const day = calendarDayWib(input.now);
  const current = snapshot.day === day ? snapshot : { day, byIp: {}, total: 0 };
  const ip = input.ip.trim() || "unknown";
  const used = current.byIp[ip] ?? 0;
  if (used >= input.perIp) {
    return { snapshot: current, allowed: false, message: ipLimitMessage(ip, input.perIp) };
  }
  if (current.total >= input.global) {
    return { snapshot: current, allowed: false, message: globalLimitMessage() };
  }
  return {
    snapshot: {
      day,
      byIp: { ...current.byIp, [ip]: used + 1 },
      total: current.total + 1,
    },
    allowed: true,
  };
}

export function ipLimitMessage(ip: string, limit: number): string {
  return `This address (${ip}) has already started ${limit} live reports today. Open a featured report on the home page instead of starting another one.`;
}

export function globalLimitMessage(): string {
  return "Live reports are paused for today because the shared daily limit is full. Open a featured report on the home page instead.";
}
