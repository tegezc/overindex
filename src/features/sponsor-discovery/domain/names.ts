const SUFFIXES = new Set(["inc", "llc", "co"]);

/** Lowercase, strip punctuation, drop trailing Inc / LLC / Co. */
export function normalizeBrandName(name: string): string {
  const tokens = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  while (tokens.length > 1 && SUFFIXES.has(tokens[tokens.length - 1] ?? "")) tokens.pop();
  return tokens.join(" ");
}

/**
 * Exact normalized match, or the shorter name is a whole token sequence inside the longer one.
 * The shorter side must be at least 3 characters so "Co" does not match "Acme".
 */
export function nameAccepts(query: string, candidate: string): boolean {
  const left = normalizeBrandName(query);
  const right = normalizeBrandName(candidate);
  if (!left || !right) return false;
  if (left === right) return true;
  const leftTokens = left.split(" ");
  const rightTokens = right.split(" ");
  const shorter = leftTokens.length <= rightTokens.length ? leftTokens : rightTokens;
  const longer = leftTokens.length <= rightTokens.length ? rightTokens : leftTokens;
  if (shorter.join("").length < 3) return false;
  return containsTokenSequence(longer, shorter);
}

function containsTokenSequence(haystack: readonly string[], needle: readonly string[]): boolean {
  if (needle.length === 0 || needle.length > haystack.length) return false;
  for (let start = 0; start <= haystack.length - needle.length; start += 1) {
    if (needle.every((token, offset) => haystack[start + offset] === token)) return true;
  }
  return false;
}

export function selectNamed<T extends { name: string }>(query: string, candidates: readonly T[]): T | undefined {
  const accepted = candidates.filter((candidate) => nameAccepts(query, candidate.name));
  if (accepted.length === 0) return undefined;
  const queryKey = normalizeBrandName(query);
  return [...accepted].sort((a, b) => {
    const aExact = normalizeBrandName(a.name) === queryKey ? 0 : 1;
    const bExact = normalizeBrandName(b.name) === queryKey ? 0 : 1;
    if (aExact !== bExact) return aExact - bExact;
    return a.name.length - b.name.length;
  })[0];
}

/**
 * A user exclusion matches a label when the normalized texts are equal,
 * the exclusion is a whole token, or a multi-word exclusion is a phrase inside the label.
 */
export function isCategoryExcluded(labels: readonly string[], excluded: readonly string[]): boolean {
  const bans = excluded.map(normalizeBrandName).filter(Boolean);
  if (bans.length === 0) return false;
  for (const label of labels) {
    const norm = normalizeBrandName(label);
    if (!norm) continue;
    const tokens = new Set(norm.split(" "));
    for (const ban of bans) {
      if (norm === ban) return true;
      if (!ban.includes(" ") && tokens.has(ban)) return true;
      if (ban.includes(" ") && norm.includes(ban)) return true;
    }
  }
  return false;
}

export type ResolveKind = "user_sponsor" | "llm_baseline" | "lane_a";

export type QueuedName = {
  name: string;
  kind: ResolveKind;
};

/** Sponsors first, then LLM suggestions, then Lane A names that are not already in hand. */
export function resolutionQueue(input: {
  sponsors: readonly string[];
  llmNames: readonly string[];
  laneANames: readonly string[];
  already: ReadonlySet<string>;
}): QueuedName[] {
  const seen = new Set(input.already);
  const queued: QueuedName[] = [];
  const push = (name: string, kind: ResolveKind) => {
    const key = normalizeBrandName(name);
    if (!key || seen.has(key)) return;
    seen.add(key);
    queued.push({ name, kind });
  };
  for (const name of input.sponsors) push(name, "user_sponsor");
  for (const name of input.llmNames) push(name, "llm_baseline");
  for (const name of input.laneANames) push(name, "lane_a");
  return queued;
}
