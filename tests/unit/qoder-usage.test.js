import { beforeEach, describe, expect, it, vi } from "vitest";

const proxyAwareFetch = vi.fn();

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch,
}));

describe("Qoder quota usage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("hides zero allocation and Qoder's year-9999 reset sentinel", async () => {
    proxyAwareFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        userType: "free",
        totalUsagePercentage: 0,
        isQuotaExceeded: true,
        expiresAt: 253402214400000,
        userQuota: {
          total: 0,
          used: 0,
          remaining: 0,
          percentage: 0,
          unit: "credits",
        },
      }),
    });

    const { getUsageForProvider } = await import("../../open-sse/services/usage.js");
    const usage = await getUsageForProvider({
      provider: "qoder",
      accessToken: "qoder-token",
    });

    expect(usage.quotas).toEqual({});
    expect(usage.expiresAt).toBeNull();
    expect(usage.isQuotaExceeded).toBe(true);
    expect(usage.message).toContain("quota is exhausted");
  });

  it("keeps real positive Qoder quota allocations", async () => {
    proxyAwareFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        totalUsagePercentage: 25,
        isQuotaExceeded: false,
        expiresAt: Date.parse("2026-07-01T00:00:00.000Z"),
        userQuota: {
          total: 1000,
          used: 250,
          remaining: 750,
          unit: "credits",
        },
      }),
    });

    const { getUsageForProvider } = await import("../../open-sse/services/usage.js");
    const usage = await getUsageForProvider({
      provider: "qoder",
      accessToken: "qoder-token",
    });

    expect(usage.message).toBeUndefined();
    expect(usage.quotas.user).toEqual({
      total: 1000,
      used: 250,
      remaining: 750,
      unit: "credits",
      resetAt: "2026-07-01T00:00:00.000Z",
    });
  });
});
