import { describe, expect, it } from "vitest";
import { readDemographicRows, readTasteEntities, readTasteTags, toDemographicsSection } from "./taste-card";
import type { Provenance } from "@/shared/qloo/domain/provenance";

const provenance: Provenance = {
  callId: "call-1",
  tool: "qloo_audience_demographics",
  params: { entity: "show-north" },
  at: "2026-10-20T01:00:00.000Z",
  status: "ok",
  cached: false,
};

describe("taste card readers", () => {
  it("reads recommendation entities and tags", () => {
    expect(readTasteEntities([{ entity_id: "a", name: "Artist Alpha" }, { name: "Missing id" }])).toEqual([
      { id: "a", name: "Artist Alpha" },
    ]);
    expect(readTasteTags([{ name: "Topic Alpha" }, { tags: [{ id: "tag-1", name: "Topic Beta" }] }])).toEqual([
      { id: "Topic Alpha", name: "Topic Alpha" },
      { id: "tag-1", name: "Topic Beta" },
    ]);
  });

  it("keeps age rows and drops sensitive labels", () => {
    expect(
      readDemographicRows([
        { name: "political preference", affinity: 0.2 },
        { name: "25 to 29", query: { affinity: 0.4 } },
        { age: { "35_to_44": 0.3 } },
      ]),
    ).toEqual([
      { label: "25 to 29", value: 0.4 },
      { label: "35 to 44", value: 0.3 },
    ]);
  });

  it("reads age and gender buckets nested under query", () => {
    expect(
      readDemographicRows([
        {
          entity_id: "demo-1",
          query: {
            age: { "25_to_29": 0.2, "35_to_44": 0.3 },
            gender: { female: 0.6 },
          },
        },
      ]),
    ).toEqual([
      { label: "age 25 to 29", value: 0.2 },
      { label: "age 35 to 44", value: 0.3 },
      { label: "gender female", value: 0.6 },
    ]);
  });

  it("omits demographics when Qloo returns an empty list", () => {
    expect(toDemographicsSection({ status: "empty", results: [], provenance })).toBeUndefined();
    expect(toDemographicsSection({ status: "ok", results: [], provenance })).toBeUndefined();
  });

  it("keeps a status when Qloo returns demographics this screen cannot list", () => {
    const section = toDemographicsSection({ status: "ok", results: [{ marker: true }], provenance });
    expect(section?.status).toBe("ok");
    expect(section?.data).toBeUndefined();
    expect(section?.note).toMatch(/does not list/);
  });
});
