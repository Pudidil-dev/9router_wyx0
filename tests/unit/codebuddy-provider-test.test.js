import { beforeEach, describe, expect, it, vi } from "vitest";

const getProviderConnectionById = vi.fn();
const updateProviderConnection = vi.fn();
const resolveConnectionProxyConfig = vi.fn();
const testProxyUrl = vi.fn();

vi.mock("@/lib/localDb", () => ({
  getProviderConnectionById,
  updateProviderConnection,
}));

vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig,
}));

vi.mock("@/lib/network/proxyTest", () => ({
  testProxyUrl,
}));

describe("CodeBuddy provider test support", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
    resolveConnectionProxyConfig.mockResolvedValue({
      connectionProxyEnabled: false,
      connectionProxyUrl: "",
      connectionNoProxy: "",
    });
    testProxyUrl.mockResolvedValue({ ok: true });
  });

  function mockCodeBuddyConnection() {
    getProviderConnectionById.mockResolvedValue({
      id: "cb-1",
      provider: "codebuddy",
      authType: "apikey",
      apiKey: "cb-test-key",
      providerSpecificData: {},
    });
  }

  it("treats a successful CodeBuddy model probe as a valid connection", async () => {
    mockCodeBuddyConnection();
    global.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    });

    const { testSingleConnection } = await import("../../src/app/api/providers/[id]/test/testUtils.js");
    const result = await testSingleConnection("cb-1");

    expect(result.valid).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith(
      "https://www.codebuddy.ai/v2/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer cb-test-key",
          "X-Domain": "www.codebuddy.ai",
        }),
      }),
    );

    const requestOptions = global.fetch.mock.calls[0][1];
    expect(JSON.parse(requestOptions.body)).toEqual(expect.objectContaining({
      model: "default-model",
      stream: false,
      max_tokens: 1,
    }));

    expect(updateProviderConnection).toHaveBeenCalledWith("cb-1", expect.objectContaining({
      testStatus: "active",
      lastError: null,
    }));
  });

  it("treats non-auth CodeBuddy failures like 429 as still supported", async () => {
    mockCodeBuddyConnection();
    global.fetch.mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({}),
    });

    const { testSingleConnection } = await import("../../src/app/api/providers/[id]/test/testUtils.js");
    const result = await testSingleConnection("cb-1");

    expect(result.valid).toBe(true);
    expect(updateProviderConnection).toHaveBeenCalledWith("cb-1", expect.objectContaining({
      testStatus: "active",
      lastError: null,
    }));
  });

  it("still marks 401 CodeBuddy responses as invalid credentials", async () => {
    mockCodeBuddyConnection();
    global.fetch.mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({}),
    });

    const { testSingleConnection } = await import("../../src/app/api/providers/[id]/test/testUtils.js");
    const result = await testSingleConnection("cb-1");

    expect(result.valid).toBe(false);
    expect(result.error).toBe("Invalid API key");
    expect(updateProviderConnection).toHaveBeenCalledWith("cb-1", expect.objectContaining({
      testStatus: "error",
      lastError: "Invalid API key",
    }));
  });
});
