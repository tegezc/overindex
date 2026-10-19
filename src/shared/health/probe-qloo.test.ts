import { describe, expect, it } from "vitest";
import { probeQloo } from "./probe-qloo";

describe("probeQloo", () => {
  it("reports ready only when the base URL check and capabilities both succeed", async () => {
    await expect(probeQloo({ assertBaseUrl: async () => {}, capabilities: async () => "ready" })).resolves.toBe("ready");
    await expect(
      probeQloo({
        assertBaseUrl: async () => {
          throw new Error("BASE_URL");
        },
        capabilities: async () => "ready",
      }),
    ).resolves.toBe("missing");
    await expect(probeQloo({ assertBaseUrl: async () => {}, capabilities: async () => "missing" })).resolves.toBe(
      "missing",
    );
  });
});
