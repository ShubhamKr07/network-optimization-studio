import { describe, it, expect, vi, beforeEach } from "vitest";
import { logger } from "../lib/logger.js";
import { warnOnMissingEmailConfig } from "../lib/email.js";

describe("warnOnMissingEmailConfig", () => {
  const err = vi.spyOn(logger, "error").mockImplementation(() => {});
  const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
  beforeEach(() => vi.clearAllMocks());

  it("errors (without throwing) naming RESEND_API_KEY when it is absent", () => {
    expect(() => warnOnMissingEmailConfig({})).not.toThrow();
    expect(err).toHaveBeenCalledWith({ variable: "RESEND_API_KEY" }, expect.stringContaining("fail silently"));
    expect(warn).toHaveBeenCalledTimes(2); // EMAIL_FROM, APP_BASE_URL
  });

  it("is silent when all three are present", () => {
    warnOnMissingEmailConfig({ RESEND_API_KEY: "re_x", EMAIL_FROM: "a@b.c", APP_BASE_URL: "https://x" });
    expect(err).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });
});
