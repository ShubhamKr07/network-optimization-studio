// Throwaway test for the temporary routes/diag.ts -- delete with it.
import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import { logger } from "../lib/logger.js";
import app from "../app.js";

describe("GET /api/_diag/client-ip", () => {
  it("responds 204 with no body and logs the diagnostic keys", async () => {
    const spy = vi.spyOn(logger, "info");
    const res = await request(app)
      .get("/api/_diag/client-ip")
      .set("x-forwarded-for", "1.2.3.4, 5.6.7.8")
      .set("cf-connecting-ip", "1.2.3.4");
    expect(res.status).toBe(204);
    expect(res.text).toBe("");
    const payload = spy.mock.calls.map((c) => c[0] as Record<string, unknown>).find((o) => o?.diag === "client-ip")!;
    expect(Object.keys(payload)).toEqual(
      expect.arrayContaining(["ip", "remoteAddress", "xForwardedFor", "cfConnectingIpPresent", "cfConnectingIp", "ips", "trustProxy"]),
    );
    expect(payload.xForwardedFor).toBe("1.2.3.4, 5.6.7.8");
    expect(payload.cfConnectingIp).toBe("1.2.3.4");
    spy.mockRestore();
  });
});
