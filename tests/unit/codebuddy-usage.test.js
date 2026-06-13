import { beforeEach, describe, expect, it, vi } from "vitest";

const proxyAwareFetch = vi.fn();

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch,
}));

describe("CodeBuddy quota usage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses an API key and parses CodeBuddy credit quota", async () => {
    proxyAwareFetch
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => ({}),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          code: 0,
          data: {
            Response: {
              Data: {
                Accounts: [
                  {
                    PackageCode: "TCACA_code_006_DbXS0lrypC",
                    CycleCapacitySizePrecise: 250,
                    CycleCapacityRemainPrecise: 249.88,
                    CapacityUsedPrecise: 0.12,
                    CycleEndTime: "2026-06-27T08:57:02.000Z",
                  },
                ],
              },
            },
          },
        }),
      });

    const { getUsageForProvider } = await import("../../open-sse/services/usage.js");
    const usage = await getUsageForProvider({
      provider: "codebuddy",
      authType: "apikey",
      apiKey: "cb-api-key",
      providerSpecificData: {},
    });

    expect(proxyAwareFetch).toHaveBeenNthCalledWith(
      2,
      "https://www.codebuddy.ai/v2/billing/meter/get-user-resource",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer cb-api-key",
          "X-Domain": "www.codebuddy.ai",
        }),
      }),
      null,
    );
    expect(usage.plan).toBe("Free");
    expect(usage.quotas["Gift Credits"]).toEqual(expect.objectContaining({
      used: 0.12,
      total: 250,
      remaining: 249.88,
    }));
  });

  it("falls back to a stored web cookie when no token is available", async () => {
    proxyAwareFetch.mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => "",
    });

    const { getUsageForProvider } = await import("../../open-sse/services/usage.js");
    const usage = await getUsageForProvider({
      provider: "codebuddy",
      authType: "apikey",
      providerSpecificData: {
        webCookie: "session=test",
      },
    });

    expect(proxyAwareFetch).toHaveBeenCalledWith(
      "https://www.codebuddy.ai/v2/billing/meter/get-user-resource",
      expect.objectContaining({
        headers: expect.objectContaining({
          Cookie: "session=test",
        }),
      }),
      null,
    );
    expect(usage.message).toContain("quota cookie is expired");
  });
});
