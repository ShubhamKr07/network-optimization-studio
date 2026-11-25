import { describe, it, expect } from "vitest";
import { RegisterUserBody, LoginUserBody } from "@workspace/api-zod";

// WQF-B1 — acceptTerms is part of the auth contract. Before the OpenAPI change
// zod's default object mode silently STRIPS the key, so the server would never
// see the student's tick: the toEqual below is what catches that.
describe("WQF-B1 — acceptTerms in the auth request schemas", () => {
  it("RegisterUserBody keeps acceptTerms", () => {
    const body = { email: "a@example.test", password: "correcthorse1", acceptTerms: true };
    expect(RegisterUserBody.parse(body)).toEqual(body);
  });

  it("LoginUserBody keeps acceptTerms", () => {
    const body = { email: "a@example.test", password: "correcthorse1", acceptTerms: true };
    expect(LoginUserBody.parse(body)).toEqual(body);
  });

  it("acceptTerms must be a boolean, not a truthy string", () => {
    expect(RegisterUserBody.safeParse({ email: "a@example.test", password: "correcthorse1", acceptTerms: "true" }).success).toBe(false);
    expect(LoginUserBody.safeParse({ email: "a@example.test", password: "correcthorse1", acceptTerms: "true" }).success).toBe(false);
  });

  it("stays optional (the server, not the validator, owns the refusal — D1)", () => {
    expect(RegisterUserBody.safeParse({ email: "a@example.test", password: "correcthorse1" }).success).toBe(true);
    expect(LoginUserBody.safeParse({ email: "a@example.test", password: "x" }).success).toBe(true);
  });
});
