import { describe, expect, it } from "vitest";
import { extractShowCandidates } from "./candidates";

const NORTH = "AAAAAAAA-BBBB-4CCC-8DDD-000000000001";
const EXTRA = "AAAAAAAA-BBBB-4CCC-8DDD-000000000002";

describe("extractShowCandidates", () => {
  it("keeps an exact match and drops search alternatives", () => {
    const extracted = extractShowCandidates({
      status: "ok",
      results: [{ entity_id: NORTH, name: "Show North" }],
      resolution: {
        outcomes: [
          {
            status: "resolved",
            match: "exact",
            selected: { id: NORTH, name: "Show North", type: "urn:entity:podcast", description: "A north desk." },
            alternatives: [{ id: EXTRA, name: "Show North Night", type: "podcast" }],
          },
        ],
      },
    });
    expect(extracted.confident).toBe(true);
    expect(extracted.candidates.map((candidate) => candidate.id)).toEqual([NORTH]);
    expect(extracted.candidates[0]?.description).toBe("A north desk.");
  });

  it("keeps a semantic match together with alternatives", () => {
    const extracted = extractShowCandidates({
      resolution: {
        outcomes: [
          {
            status: "resolved",
            match: "semantic",
            selected: { id: NORTH, name: "Show North", type: "podcast" },
            alternatives: [{ id: EXTRA, name: "Show North Night", type: "podcast" }],
          },
        ],
      },
    });
    expect(extracted.confident).toBe(false);
    expect(extracted.candidates).toHaveLength(2);
  });

  it("reads needs_input candidates and ignores non-podcast types", () => {
    const extracted = extractShowCandidates({
      status: "needs_input",
      results: [],
      resolution: {
        issues: [
          {
            kind: "ambiguous",
            candidates: [
              { id: NORTH, name: "Show North", type: "urn:entity:podcast" },
              { id: EXTRA, name: "North Brand", type: "urn:entity:brand" },
            ],
          },
        ],
      },
    });
    expect(extracted.candidates).toEqual([{ id: NORTH, name: "Show North", type: "podcast" }]);
  });

  it("returns no candidates for not_found", () => {
    expect(
      extractShowCandidates({
        status: "needs_input",
        results: [],
        resolution: { issues: [{ kind: "not_found", input: "zzqx" }] },
      }),
    ).toEqual({ candidates: [], confident: false });
  });
});
