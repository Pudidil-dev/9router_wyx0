import { beforeEach, describe, expect, it, vi } from "vitest";

const proxyAwareFetch = vi.fn();

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch,
}));

function makeJwt(payload) {
  return `header.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.sig`;
}

describe("CodeBuddy CN usage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("parses credit snapshots and emits provider metadata patches", async () => {
    proxyAwareFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        code: 0,
        data: {
          Response: {
            Data: {
              Accounts: [
                {
                  PackageCode: "TCACA_code_002_AkiJS3ZHF5",
                  PackageName: "Monthly Credits",
                  CycleCapacitySizePrecise: "500",
                  CycleCapacityUsedPrecise: "10",
                  CycleStartTime: "2026-06-01T00:00:00Z",
                  CycleEndTime: "2026-07-01T00:00:00Z",
                  DeductionEndTime: "1785542400000"
                },
                {
                  PackageCode: "TCACA_code_006_DbXS0lrypC",
                  PackageName: "Gift Credits",
                  CapacitySizePrecise: "100",
                  CapacityUsedPrecise: "50",
                  CycleEndTime: "2026-08-01T00:00:00Z",
                  DeductionEndTime: "1785542400000"
                }
              ]
            }
          }
        }
      }),
    });

    const { getUsageForProvider } = await import("../../open-sse/services/usage.js");
    const usage = await getUsageForProvider({
      provider: "codebuddy-cn",
      authType: "oauth",
      accessToken: makeJwt({ sub: "cbcn-user", email: "cbcn@example.com" }),
      providerSpecificData: {},
    });

    expect(proxyAwareFetch).toHaveBeenCalledWith(
      "https://copilot.tencent.com/v2/billing/meter/get-user-resource",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Authorization": expect.stringContaining("Bearer "),
        }),
      }),
      null,
    );
    expect(usage.plan).toBe("Monthly Credits");
    expect(usage.quotas["Monthly"]).toEqual(expect.objectContaining({
      total: 500,
      used: 10,
    }));
    expect(usage.quotas["Bonus Pack 1"]).toEqual(expect.objectContaining({
      total: 100,
      used: 50,
    }));
    expect(usage.providerSpecificDataPatch).toEqual(expect.objectContaining({
      authKind: "access_token",
      jwtSub: "cbcn-user",
      jwtEmail: "cbcn@example.com",
    }));
  });

  it("reports missing CN credentials clearly", async () => {
    const { getUsageForProvider } = await import("../../open-sse/services/usage.js");
    const usage = await getUsageForProvider({
      provider: "codebuddy-cn",
      authType: "oauth",
      providerSpecificData: {},
    });

    expect(proxyAwareFetch).not.toHaveBeenCalled();
    expect(usage.message).toContain("credential not available");
    expect(usage.quotas).toEqual({});
  });
});
