import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildCodeBuddyCnProviderMetadata,
  resolveCodeBuddyCnCredential,
} from "../../open-sse/services/codebuddyCn.js";

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

function makeJwt(payload) {
  return `header.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.sig`;
}

describe("CodeBuddy CN credential helpers", () => {
  it("prefers apiKey over access and jwt tokens", () => {
    const resolved = resolveCodeBuddyCnCredential({
      apiKey: "api-key",
      accessToken: "access-token",
      idToken: makeJwt({ sub: "user-1" }),
    });

    expect(resolved).toMatchObject({
      authKind: "api_key",
      token: "api-key",
      source: "apiKey",
    });
  });

  it("extracts identity metadata from JWT-shaped tokens", () => {
    const metadata = buildCodeBuddyCnProviderMetadata({
      accessToken: makeJwt({
        sub: "user-123",
        email: "cbcn@example.com",
        exp: 1893456000,
        enterprise_id: "ent-9",
      }),
      providerSpecificData: {},
    });

    expect(metadata).toMatchObject({
      authKind: "access_token",
      jwtSub: "user-123",
      jwtEmail: "cbcn@example.com",
      jwtExp: 1893456000,
      codebuddyCnUserId: "user-123",
      codebuddyCnEnterpriseId: "ent-9",
    });
  });
});

describe("CodeBuddy CN provider test route", () => {
  let fetchMock;

  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock = vi.fn();
    global.fetch = fetchMock;
    resolveConnectionProxyConfig.mockResolvedValue({
      connectionProxyEnabled: false,
      connectionProxyUrl: "",
      connectionNoProxy: "",
    });
    testProxyUrl.mockResolvedValue({ ok: true });
  });

  it("accepts access_token auth and persists recovered JWT metadata", async () => {
    const accessToken = makeJwt({
      sub: "cbcn-user",
      email: "cbcn@example.com",
      exp: 1893456000,
    });

    getProviderConnectionById.mockResolvedValue({
      id: "cbcn-1",
      provider: "codebuddy-cn",
      authType: "oauth",
      accessToken,
      providerSpecificData: {},
    });

    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ data: [] }),
    });

    const { testSingleConnection } = await import("../../src/app/api/providers/[id]/test/testUtils.js");
    const result = await testSingleConnection("cbcn-1");

    expect(result.valid).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://www.codebuddy.cn/console/api/client/v1/api-keys",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          Authorization: `Bearer ${accessToken}`,
          "X-Domain": "www.codebuddy.cn",
        }),
      }),
    );
    expect(updateProviderConnection).toHaveBeenCalledWith("cbcn-1", expect.objectContaining({
      testStatus: "active",
      providerSpecificData: expect.objectContaining({
        authKind: "access_token",
        jwtSub: "cbcn-user",
        jwtEmail: "cbcn@example.com",
        jwtExp: 1893456000,
        creditSource: "codebuddy-cn",
      }),
    }));
  });
});
