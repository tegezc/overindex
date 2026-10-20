import { describe, expect, it } from "vitest";
import { clientAddress } from "./client-address";

describe("client address", () => {
  it("reads the first forwarded hop and ignores the rest", () => {
    const request = new Request("http://localhost/api/report", {
      headers: { "x-forwarded-for": "203.0.113.4, 10.0.0.1" },
    });
    expect(clientAddress(request)).toBe("203.0.113.4");
  });

  it("uses unknown when the header is missing", () => {
    expect(clientAddress(new Request("http://localhost/api/report"))).toBe("unknown");
  });
});
