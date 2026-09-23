import { describe, it, expect } from "vitest";
import { normalizeEmail, withNormalizedEmail } from "../lib/normalizeEmail.js";

describe("normalizeEmail", () => {
  it("trims surrounding whitespace and lowercases", () => {
    expect(normalizeEmail("  Student@Example.COM  ")).toBe("student@example.com");
  });

  it("is idempotent — normalizing an already-normal address changes nothing", () => {
    expect(normalizeEmail("student@example.com")).toBe("student@example.com");
  });

  it("collapses every casing of one address to a single value", () => {
    const spellings = ["foo@x.com", "Foo@x.com", "FOO@X.COM", "fOo@X.cOm"];
    expect(new Set(spellings.map(normalizeEmail)).size).toBe(1);
  });

  it("leaves the local part's internal characters alone", () => {
    // Only case and edge whitespace are canonical here. Dots and plus-tags are
    // provider-specific semantics we deliberately do NOT collapse — treating
    // `a.b@gmail.com` and `ab@gmail.com` as one account would be wrong for
    // every provider that doesn't work like Gmail.
    expect(normalizeEmail("First.Last+lab3@Example.com")).toBe("first.last+lab3@example.com");
  });
});

describe("withNormalizedEmail", () => {
  it("normalizes the email field and preserves the rest of the body", () => {
    expect(withNormalizedEmail({ email: " A@B.COM ", password: "  keepMe  " })).toEqual({
      email: "a@b.com",
      password: "  keepMe  ",
    });
  });

  it("passes a non-string email through untouched, leaving the verdict to the validator", () => {
    const body = { email: 42, password: "x" };
    expect(withNormalizedEmail(body)).toEqual(body);
  });

  it("passes non-object bodies through untouched", () => {
    expect(withNormalizedEmail(null)).toBeNull();
    expect(withNormalizedEmail("not a body")).toBe("not a body");
    expect(withNormalizedEmail([{ email: "A@B.com" }])).toEqual([{ email: "A@B.com" }]);
  });

  it("does not mutate the body it was given", () => {
    const body = { email: " A@B.COM " };
    withNormalizedEmail(body);
    expect(body.email).toBe(" A@B.COM ");
  });
});
