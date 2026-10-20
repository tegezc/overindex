import type { Evidence, UncheckedPitch } from "./evidence";

export const NUMBER_NOT_IN_EVIDENCE = "number is not in the cited evidence";
export const CAUSAL_OR_INDIVIDUAL = "causal or individual claim";
export const MISSING_EVIDENCE = "cited evidence is missing";
export const QLOO_WITHOUT_PROVENANCE = "Qloo claim has no provenance";

const NUMBER = /-?\d+(?:\.\d+)?/g;

const INDIVIDUAL = [
  /\byour listeners\b/i,
  /\blisteners\s+(are|buy|buys|purchase|purchases|will|do)\b/i,
  /\b(each|every|individual)\s+listeners?\b/i,
  /\bpeople who listen\b/i,
];

const CAUSAL = [
  /\bwill\s+(increase|decrease|boost|drive|cause|raise|grow)\b/i,
  /\bincrease sales\b/i,
  /\b(because|therefore)\b/i,
  /\bleads to\b/i,
  /\bresults in\b/i,
  /\bas a result\b/i,
  /\bdue to\b/i,
  /\bcauses?\b/i,
];

export type ClaimCheck = {
  passed: boolean;
  rejected: { text: string; reason: string }[];
};

/**
 * Deterministic claim check. Rejects numbers that are not evidence values,
 * and sentences that are causal or about individual listeners.
 */
export function checkClaims(pitch: UncheckedPitch, evidence: readonly Evidence[]): ClaimCheck {
  const byId = new Map(evidence.map((item) => [item.id, item]));
  const rejected: { text: string; reason: string }[] = [];
  const seen = new Set<string>();
  const reject = (text: string, reason: string) => {
    const key = `${reason}\n${text}`;
    if (seen.has(key)) return;
    seen.add(key);
    rejected.push({ text, reason });
  };

  const cited = new Map<string, Evidence>();
  for (const claim of pitch.claims) {
    const bundle: Evidence[] = [];
    if (claim.evidenceIds.length === 0) reject(claim.text, MISSING_EVIDENCE);
    for (const id of claim.evidenceIds) {
      const item = byId.get(id);
      if (!item) {
        reject(claim.text, MISSING_EVIDENCE);
        continue;
      }
      bundle.push(item);
      cited.set(item.id, item);
    }
    if (forbidden(claim.text)) reject(claim.text, CAUSAL_OR_INDIVIDUAL);
    if (claim.source === "qloo" && !qlooBundle(bundle)) reject(claim.text, QLOO_WITHOUT_PROVENANCE);
    if (claim.source === "user_input" && bundle.some((item) => item.kind !== "user_input")) {
      reject(claim.text, MISSING_EVIDENCE);
    }
    for (const raw of numbersIn(claim.text)) {
      if (!numberAllowed(raw, bundle)) reject(claim.text, NUMBER_NOT_IN_EVIDENCE);
    }
  }

  const pool = [...cited.values()];
  for (const text of [pitch.body, ...pitch.talkingPoints]) {
    if (forbidden(text)) reject(text, CAUSAL_OR_INDIVIDUAL);
    for (const raw of numbersIn(text)) {
      if (!numberAllowed(raw, pool)) reject(text, NUMBER_NOT_IN_EVIDENCE);
    }
  }

  return { passed: rejected.length === 0, rejected };
}

function qlooBundle(bundle: readonly Evidence[]): boolean {
  return bundle.length > 0 && bundle.every((item) => item.kind !== "user_input" && item.provenance !== undefined);
}

function forbidden(text: string): boolean {
  return INDIVIDUAL.some((pattern) => pattern.test(text)) || CAUSAL.some((pattern) => pattern.test(text));
}

function numbersIn(text: string): string[] {
  return text.match(NUMBER) ?? [];
}

function numberAllowed(raw: string, bundle: readonly Evidence[]): boolean {
  const shown = Number(raw);
  if (!Number.isFinite(shown)) return false;
  const decimals = raw.includes(".") ? (raw.split(".")[1]?.length ?? 0) : 0;
  return numericValues(bundle).some((value) => roundTo(value, decimals) === shown);
}

function numericValues(bundle: readonly Evidence[]): number[] {
  const values: number[] = [];
  for (const item of bundle) {
    if (typeof item.value === "number" && Number.isFinite(item.value)) values.push(item.value);
    if (typeof item.value === "string") {
      for (const raw of numbersIn(item.value)) {
        const value = Number(raw);
        if (Number.isFinite(value)) values.push(value);
      }
    }
  }
  return values;
}

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
