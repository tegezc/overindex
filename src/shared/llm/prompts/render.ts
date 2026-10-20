/**
 * Replaces `{token}` markers in `template` without scanning inserted values.
 * A show description that itself contains `{show_name}` stays literal.
 */
export function renderTemplate(template: string, values: Record<string, string>): string {
  const hits: { at: number; token: string; value: string }[] = [];
  for (const [key, value] of Object.entries(values)) {
    const token = `{${key}}`;
    const at = template.indexOf(token);
    if (at < 0) throw new Error(`missing placeholder ${token}`);
    if (template.indexOf(token, at + token.length) >= 0) throw new Error(`duplicate placeholder ${token}`);
    hits.push({ at, token, value });
  }
  hits.sort((a, b) => a.at - b.at);

  let cursor = 0;
  let out = "";
  for (const hit of hits) {
    if (hit.at < cursor) throw new Error(`overlapping placeholder ${hit.token}`);
    out += template.slice(cursor, hit.at);
    out += hit.value;
    cursor = hit.at + hit.token.length;
  }
  return out + template.slice(cursor);
}
