import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { sendEmail } from "../lib/email.js";
import { makeRateLimiter } from "../lib/rateLimit.js";

describe("sendEmail", () => {
  beforeEach(() => {
    process.env.RESEND_API_KEY = "re_test_key";
    process.env.EMAIL_FROM = "noreply@app.networkdesignbook.com";
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.RESEND_API_KEY;
    delete process.env.EMAIL_FROM;
  });

  it("posts to Resend with the bearer key and the configured sender", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => "{}" });
    vi.stubGlobal("fetch", fetchMock);

    await sendEmail("student@example.test", "Subject", "<p>Body</p>");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.resend.com/emails");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer re_test_key");
    expect(JSON.parse(init.body as string)).toEqual({
      from: "noreply@app.networkdesignbook.com",
      to: "student@example.test",
      subject: "Subject",
      html: "<p>Body</p>",
    });
  });

  it("throws with the status and body when Resend refuses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 422, text: async () => "bad domain" }));
    await expect(sendEmail("a@b.test", "S", "<p>B</p>")).rejects.toThrow(/422.*bad domain/);
  });

  it("throws without calling fetch when the API key is missing", async () => {
    delete process.env.RESEND_API_KEY;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(sendEmail("a@b.test", "S", "<p>B</p>")).rejects.toThrow(/RESEND_API_KEY/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("makeRateLimiter", () => {
  it("allows up to the limit and trips after it", () => {
    const limiter = makeRateLimiter(3, 60_000);
    expect(limiter.check("k")).toBe(false);
    expect(limiter.check("k")).toBe(false);
    expect(limiter.check("k")).toBe(false);
    expect(limiter.check("k")).toBe(true);
  });

  it("keys are independent", () => {
    const limiter = makeRateLimiter(1, 60_000);
    expect(limiter.check("a")).toBe(false);
    expect(limiter.check("b")).toBe(false);
    expect(limiter.check("a")).toBe(true);
  });

  // The reason this factory exists rather than a second inline copy of
  // login's Map: this limiter is keyed by caller-supplied email, so without
  // eviction the Map is a memory leak any unauthenticated caller can drive.
  it("evicts keys whose window has elapsed, so the map does not grow without bound", () => {
    vi.useFakeTimers();
    try {
      const limiter = makeRateLimiter(5, 1_000);
      for (let i = 0; i < 50; i++) limiter.check(`caller-${i}@example.test`);
      expect(limiter.size()).toBe(50);

      vi.advanceTimersByTime(1_500);
      limiter.check("someone-else@example.test");

      expect(limiter.size()).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reset() clears everything", () => {
    const limiter = makeRateLimiter(1, 60_000);
    limiter.check("a");
    limiter.reset();
    expect(limiter.size()).toBe(0);
    expect(limiter.check("a")).toBe(false);
  });
});
