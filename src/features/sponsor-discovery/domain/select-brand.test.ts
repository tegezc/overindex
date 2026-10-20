import { describe, expect, it } from "vitest";
import { selectBrand } from "./select-brand";

const RIGHT = "AAAAAAAA-BBBB-4CCC-8DDD-0000000000A1";
const WRONG = "AAAAAAAA-BBBB-4CCC-8DDD-0000000000B2";
const LONG = "AAAAAAAA-BBBB-4CCC-8DDD-0000000000C3";

describe("selectBrand", () => {
  it("accepts an exact brand and ignores a podcast alternative", () => {
    const selected = selectBrand(
      {
        status: "ok",
        results: [{ entity_id: RIGHT, name: "Brand Alpha", type: "brand" }],
        resolution: {
          outcomes: [
            {
              match: "exact",
              selected: { id: RIGHT, name: "Brand Alpha", type: "urn:entity:brand" },
              alternatives: [{ id: WRONG, name: "Brand Alpha Night", type: "podcast" }],
            },
          ],
        },
      },
      "Brand Alpha",
    );
    expect(selected).toEqual({ id: RIGHT, name: "Brand Alpha" });
  });

  it("rejects an ok entity whose name does not match the query", () => {
    expect(
      selectBrand(
        {
          status: "ok",
          results: [{ entity_id: WRONG, name: "Carbon", type: "brand" }],
        },
        "Brand Alpha",
      ),
    ).toBeUndefined();
  });

  it("picks the needs_input candidate whose name matches", () => {
    const selected = selectBrand(
      {
        status: "needs_input",
        results: [],
        resolution: {
          issues: [
            {
              candidates: [
                { id: WRONG, name: "Other Brand", type: "brand" },
                { id: LONG, name: "AG1 Energy", type: "urn:entity:brand" },
              ],
            },
          ],
        },
      },
      "AG1",
    );
    expect(selected).toEqual({ id: LONG, name: "AG1 Energy" });
  });

  it("returns undefined when no candidate name matches", () => {
    expect(
      selectBrand(
        {
          status: "needs_input",
          results: [],
          resolution: { issues: [{ kind: "not_found" }] },
        },
        "Missing Brand",
      ),
    ).toBeUndefined();
  });
});
