import { describe, expect, it } from "vitest";
import { intersectBridgeTitles, readBridgeTitles } from "./bridges";

describe("bridge intersection", () => {
  it("keeps show-list order and drops ids that are not on both sides", () => {
    const shared = intersectBridgeTitles(
      [
        { id: "title-north", name: "Title North" },
        { id: "title-south", name: "Title South" },
        { id: "title-south", name: "Title South" },
      ],
      [
        { id: "title-east", name: "Title East" },
        { id: "title-south", name: "Title South" },
      ],
    );
    expect(shared).toEqual([{ id: "title-south", name: "Title South" }]);
  });

  it("reads entity ids and names from recommendation rows", () => {
    const titles = readBridgeTitles([
      { entity_id: "title-north", name: "Title North", type: "tv_show" },
      { name: "Missing Id" },
      { entity: { id: "title-south", title: "Title South" } },
    ]);
    expect(titles).toEqual([
      { id: "title-north", name: "Title North" },
      { id: "title-south", name: "Title South" },
    ]);
  });
});
