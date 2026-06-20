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
      text: async () => JSON.stringify({
        data: {
          credit_limit: 100,
          remaining_credits: 76,
          aliyun_user_type: "enterprise",
        },
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
      "https://www.codebuddy.cn/console/api/client/v1/api-keys",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          "Authorization": expect.stringContaining("Bearer "),
          "X-Domain": "www.codebuddy.cn",
        }),
      }),
      null,
    );
    expect(usage.plan).toBe("CodeBuddy CN");
    expect(usage.quotas["CodeBuddy CN Credits"]).toEqual(expect.objectContaining({
      total: 100,
      remaining: 76,
      used: 24,
    }));
    expect(usage.providerSpecificDataPatch).toEqual(expect.objectContaining({
      authKind: "access_token",
      codebuddyCnCreditLimit: 100,
      codebuddyCnCreditUsed: 24,
      aliyunUserType: "enterprise",
      creditSource: "codebuddy-cn",
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
    expect(usage.message).toContain("jwt_token, access_token, or api_key");
    expect(usage.quotas).toEqual({});
  });
});
