import { beforeEach, describe, expect, it, vi } from "vitest";
import { gunzipSync } from "zlib";

const fetchMock = vi.fn();

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: (...args) => fetchMock(...args),
}));

const { BaseExecutor } = await import("../../open-sse/executors/base.js");
const { DefaultExecutor } = await import("../../open-sse/executors/default.js");
const { getModelUpstreamId, isValidModel } = await import("../../open-sse/config/providerModels.js");

const credentials = {
  accessToken: "cb-access-token",
  providerSpecificData: {},
};

function response(status = 200) {
  return { status, headers: { get: () => "" } };
}

describe("CodeBuddy model mapping", () => {
  it("accepts public dashed Claude aliases and resolves them to CodeBuddy upstream IDs", () => {
    expect(isValidModel("cb", "claude-haiku-4.5")).toBe(true);
    expect(isValidModel("cb", "claude-haiku-4-5")).toBe(true);
    expect(getModelUpstreamId("cb", "claude-haiku-4-5")).toBe("claude-haiku-4.5");
    expect(getModelUpstreamId("cb", "claude-sonnet-4-6")).toBe("claude-sonnet-4.6");
    expect(getModelUpstreamId("cb", "claude-opus-4-6")).toBe("claude-opus-4.6");
    expect(getModelUpstreamId("cb", "claude-opus-4-7")).toBe("claude-opus-4.7-1m");
  });
});

describe("CodeBuddy executor transport", () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  it("passes CodeBuddy's gzipped body from prepareRequestBody through execute", async () => {
    fetchMock.mockResolvedValue(response(200));
    const executor = new DefaultExecutor("codebuddy");

    const out = await executor.execute({
      model: "claude-haiku-4.5",
      body: {
        messages: [{ role: "user", content: "hello" }],
        stream: true,
        max_tokens: 1,
      },
      stream: true,
      credentials,
    });

    expect(out.response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://www.codebuddy.ai/v2/chat/completions");
    expect(init.headers["Content-Encoding"]).toBe("gzip");
    expect(init.headers["X-Product"]).toBe("SaaS");
    expect(Buffer.isBuffer(init.body)).toBe(true);

    const decoded = JSON.parse(gunzipSync(init.body).toString("utf8"));
    expect(decoded).toMatchObject({
      model: "claude-haiku-4.5",
      stream: true,
      max_tokens: 16,
    });
    expect(decoded.messages[0]).toEqual({ role: "system", content: "You are CodeBuddy Code." });
    expect(decoded.messages[1]).toEqual({ role: "user", content: [{ type: "text", text: "hello" }] });
  });

  it("does not treat CodeBuddy request-illegal 403 responses as refreshable token failures", async () => {
    const executor = new DefaultExecutor("codebuddy");
    const upstream = new Response(JSON.stringify({
      code: 11140,
      msg: "request illegal",
      requestId: "req-1",
    }), { status: 403 });

    await expect(executor.shouldRefreshForResponse(upstream)).resolves.toBe(false);

    const parsed = executor.parseError(upstream, await upstream.text());
    expect(parsed.status).toBe(403);
    expect(parsed.message).toContain("request illegal");
    expect(parsed.message).toContain("CodeBuddy API key");
  });
});

describe("BaseExecutor timeout and abort behavior", () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  it("uses provider-specific connect and request timeouts", async () => {
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    fetchMock.mockResolvedValue(response(200));
    const executor = new BaseExecutor("test", {
      baseUrl: "https://example.test/chat",
      connectTimeoutMs: 1234,
      requestTimeoutMs: 5678,
    });

    try {
      await executor.execute({ model: "m", body: {}, stream: false, credentials: {} });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(setTimeoutSpy.mock.calls.some(([, delay]) => delay === 1234)).toBe(true);
      expect(setTimeoutSpy.mock.calls.some(([, delay]) => delay === 5678)).toBe(true);
    } finally {
      setTimeoutSpy.mockRestore();
    }
  });

  it("preserves external aborts instead of retrying them", async () => {
    const abortError = new DOMException("Request aborted", "AbortError");
    fetchMock.mockRejectedValue(abortError);
    const executor = new BaseExecutor("test", {
      baseUrl: "https://example.test/chat",
      retry: { 502: { attempts: 3, delayMs: 0 } },
    });
    const ctrl = new AbortController();
    ctrl.abort();

    await expect(executor.execute({
      model: "m",
      body: {},
      stream: false,
      credentials: {},
      signal: ctrl.signal,
    })).rejects.toBe(abortError);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries internally timed-out requests as network failures", async () => {
    const abortError = new DOMException("The operation was aborted due to timeout", "AbortError");
    fetchMock
      .mockImplementationOnce((url, init) => new Promise((_, reject) => {
        init.signal.addEventListener("abort", () => reject(abortError), { once: true });
      }))
      .mockResolvedValueOnce(response(200));
    const executor = new BaseExecutor("test", {
      baseUrl: "https://example.test/chat",
      connectTimeoutMs: 1,
      requestTimeoutMs: 1000,
      retry: { 502: { attempts: 1, delayMs: 0 } },
    });

    const out = await executor.execute({ model: "m", body: {}, stream: false, credentials: {} });

    expect(out.response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
