import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { KiroService } from "../../src/lib/oauth/services/kiro.js";

/**
 * Regression tests for KiroService.exchangeSocialCode retry behavior.
 *
 * Kiro's /oauth/token endpoint occasionally returns a transient 5xx
 * ("Oops, something went wrong. Please try again later.") during bulk import.
 * Because a failed exchange does not consume the single-use OAuth code, those
 * accounts are recoverable with a short bounded retry. 4xx means the code is
 * invalid/expired/consumed and must fail immediately without retry.
 *
 * The success-path return shape and the `Token exchange failed: <body>` error
 * format are preserved by the retry wrapper, so downstream consumers
 * (kiroConnections, bulk manager, API route) are unaffected.
 */
describe("kiro social code exchange retry (KiroService.exchangeSocialCode)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function mockFetchSequence(responses) {
    const calls = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      calls.push(calls.length);
      const factory = responses[Math.min(calls.length - 1, responses.length - 1)];
      const value = typeof factory === "function" ? factory() : factory;
      if (value instanceof Error) throw value;
      return value;
    });
    return () => calls.length;
  }

  function okResponse(data) {
    return {
      ok: true,
      status: 200,
      json: async () => data,
    };
  }

  function errorResponse(status, text) {
    return {
      ok: false,
      status,
      text: async () => text,
    };
  }

  it("succeeds on the first attempt without retry", async () => {
    const getCallCount = mockFetchSequence([
      okResponse({
        accessToken: "access-1",
        refreshToken: "refresh-1",
        profileArn: "arn:aws:codewhisperer:us-east-1:444:profile/X",
        expiresIn: 3600,
      }),
    ]);

    const svc = new KiroService();
    const result = await svc.exchangeSocialCode("the-code", "the-verifier");

    expect(result).toEqual({
      accessToken: "access-1",
      refreshToken: "refresh-1",
      profileArn: "arn:aws:codewhisperer:us-east-1:444:profile/X",
      expiresIn: 3600,
    });
    expect(getCallCount()).toBe(1);

    const [, init] = vi.mocked(globalThis.fetch).mock.calls[0];
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toMatchObject({
      code: "the-code",
      code_verifier: "the-verifier",
      redirect_uri: "kiro://kiro.kiroAgent/authenticate-success",
    });
  });

  it("retries a transient 500 and succeeds on the second attempt", async () => {
    const getCallCount = mockFetchSequence([
      errorResponse(500, '{"message":"Oops, something went wrong. Please try again later."}'),
      okResponse({
        accessToken: "access-2",
        refreshToken: "refresh-2",
        profileArn: "arn:aws:codewhisperer:us-east-1:444:profile/Y",
        expiresIn: 3600,
      }),
    ]);

    const svc = new KiroService();
    const promise = svc.exchangeSocialCode("the-code", "the-verifier");

    // Fast-forward the backoff sleep so the retry fires immediately.
    await vi.advanceTimersByTimeAsync(2000);

    const result = await promise;

    expect(result.accessToken).toBe("access-2");
    expect(getCallCount()).toBe(2);
  });

  it("retries a network error and succeeds when connectivity returns", async () => {
    const getCallCount = mockFetchSequence([
      new Error("fetch failed"),
      okResponse({
        accessToken: "access-3",
        refreshToken: "refresh-3",
        profileArn: "arn:aws:codewhisperer:us-east-1:444:profile/Z",
        expiresIn: 3600,
      }),
    ]);

    const svc = new KiroService();
    const promise = svc.exchangeSocialCode("the-code", "the-verifier");
    await vi.advanceTimersByTimeAsync(2000);
    const result = await promise;

    expect(result.accessToken).toBe("access-3");
    expect(getCallCount()).toBe(2);
  });

  it("fails immediately on a 4xx without retrying (single-use code must not be re-submitted)", async () => {
    const getCallCount = mockFetchSequence([
      errorResponse(400, '{"error":"invalid_grant"}'),
    ]);

    const svc = new KiroService();
    await expect(svc.exchangeSocialCode("the-code", "the-verifier"))
      .rejects.toThrow(/^Token exchange failed: \{"error":"invalid_grant"\}$/);

    expect(getCallCount()).toBe(1);
  });

  it("fails with the last error body after all retries are exhausted on a persistent 5xx", async () => {
    const getCallCount = mockFetchSequence([
      errorResponse(503, '{"message":"service unavailable"}'),
      errorResponse(502, '{"message":"bad gateway"}'),
      errorResponse(500, '{"message":"Oops, something went wrong. Please try again later."}'),
    ]);

    const svc = new KiroService();
    const promise = svc.exchangeSocialCode("the-code", "the-verifier");

    // Drive fake timers forward until the promise settles. The .rejects
    // matcher is attached first, so the rejection is never "unhandled".
    const assertion = expect(promise).rejects.toThrow(
      /^Token exchange failed: \{"message":"Oops, something went wrong. Please try again later."\}$/
    );
    // Pump the event loop enough times to flush both backoff sleeps.
    for (let i = 0; i < 6; i += 1) {
      await vi.advanceTimersByTimeAsync(1000);
    }
    await assertion;
    expect(getCallCount()).toBe(3);
  });
});
