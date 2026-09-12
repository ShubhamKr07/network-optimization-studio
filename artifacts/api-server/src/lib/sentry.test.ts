import { describe, it, expect } from "vitest";
import { scrubEvent } from "./sentry";

describe("scrubEvent", () => {
  it("strips request body, cookies, auth headers, query, email, ip", () => {
    const scrubbed = scrubEvent({
      request: {
        data: { inputs: { demand: 500 }, email: "a@b.c" },
        cookies: "nos_session=secret",
        headers: { authorization: "Bearer x", cookie: "nos_session=secret", "user-agent": "UA" },
        query_string: "scenario=1&token=abc",
        url: "https://api.example.com/scenarios/1/solve?token=abc&scenario=1",
        method: "POST",
      },
      user: { id: "u1", email: "a@b.c", ip_address: "1.2.3.4" },
      tags: { user_id: "u1", model_id: "p-median-us" },
      exception: { values: [{ type: "Error", value: "boom" }] },
    } as any);
    expect(scrubbed).toBeTruthy();
    expect(scrubbed!.request?.data).toBeUndefined();
    expect(scrubbed!.request?.cookies).toBeUndefined();
    expect(scrubbed!.request?.query_string).toBeUndefined();
    expect(scrubbed!.request?.url).toBe("/scenarios/1/solve"); // path-only, query stripped (Review 5)
    expect(scrubbed!.request?.headers).toEqual({ "user-agent": "UA" }); // auth/cookie removed
    expect(scrubbed!.user).toEqual({ id: "u1" }); // email + ip removed
    expect(scrubbed!.tags).toEqual({ user_id: "u1", model_id: "p-median-us" });
    expect(scrubbed!.exception).toBeTruthy(); // error preserved
  });

  it("reduces request.url to path-only, stripping query params", () => {
    const scrubbed = scrubEvent({
      request: {
        url: "https://nos-api-uwf8.onrender.com/scenarios/1/solve?token=abc&other=1",
      },
    } as any);
    expect(scrubbed!.request?.url).toBe("/scenarios/1/solve");
  });
});
