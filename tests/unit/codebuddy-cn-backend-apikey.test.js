import { describe, expect, it } from "vitest";
import {
  mintCodeBuddyCnApiKeyViaBackend,
  fetchCodeBuddyCnEnterpriseId,
} from "../../open-sse/services/codebuddyCn.js";

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

// Minimal proxyAwareFetch stand-in: routes by URL and records every call so we
// can assert the Bearer header and request body.
function mockFetch(handlers) {
  const calls = [];
  const impl = async (url, options) => {
    calls.push({ url, options });
    for (const handler of handlers) {
      if (handler.match(url)) return handler.response;
    }
    return jsonResponse(404, {});
  };
  impl.calls = calls;
  return impl;
}

describe("CodeBuddy CN backend API key minting", () => {
  it("returns null without an access token (never touches the network)", async () => {
    const fetchImpl = async () => {
      throw new Error("should not fetch");
    };
    expect(await mintCodeBuddyCnApiKeyViaBackend({ accessToken: "", fetchImpl })).toBeNull();
  });

  it("mints an API key using the access token as a Bearer credential", async () => {
    const fetchImpl = mockFetch([
      {
        match: (url) => url.includes("/console/accounts"),
        response: jsonResponse(200, { code: 0, data: { accounts: [{ userEnterpriseId: "ent-9", uid: "u-9" }] } }),
      },
      {
        match: (url) => url.includes("/api-keys"),
        response: jsonResponse(200, { code: 0, data: { key: "cbcn-key-123" } }),
      },
    ]);

    const apiKey = await mintCodeBuddyCnApiKeyViaBackend({ accessToken: "tok-abc", fetchImpl });

    expect(apiKey).toBe("cbcn-key-123");
    const keyCall = fetchImpl.calls.find((call) => call.url.includes("/api-keys"));
    expect(keyCall.options.headers.Authorization).toBe("Bearer tok-abc");
    const body = JSON.parse(keyCall.options.body);
    expect(body.user_enterprise_id).toBe("ent-9");
    expect(body.expire_in_days).toBe(-1);
  });

  it("returns null when the backend rejects key creation (e.g. restricted/forbidden)", async () => {
    const fetchImpl = mockFetch([
      {
        match: (url) => url.includes("/console/accounts"),
        response: jsonResponse(200, { code: 0, data: { accounts: [{ userEnterpriseId: "e" }] } }),
      },
      {
        match: (url) => url.includes("/api-keys"),
        response: jsonResponse(403, { code: 11001, msg: "forbidden" }),
      },
    ]);

    expect(await mintCodeBuddyCnApiKeyViaBackend({ accessToken: "tok", fetchImpl })).toBeNull();
  });

  it("prefers the enterprise id decoded from JWT metadata (no probe)", async () => {
    const fetchImpl = async () => {
      throw new Error("should not probe");
    };
    const context = await fetchCodeBuddyCnEnterpriseId({
      accessToken: "t",
      providerSpecificData: { codebuddyCnEnterpriseId: "ent-meta", codebuddyCnUserId: "uid-meta" },
      fetchImpl,
    });
    expect(context).toEqual({ enterpriseId: "ent-meta", uid: "uid-meta" });
  });

  it("falls back to /console/accounts for the enterprise id", async () => {
    const fetchImpl = mockFetch([
      {
        match: (url) => url.includes("/console/accounts"),
        response: jsonResponse(200, { code: 0, data: { accounts: [{ userEnterpriseId: "ent-x", uid: "u-x" }] } }),
      },
    ]);
    const context = await fetchCodeBuddyCnEnterpriseId({ accessToken: "t", fetchImpl });
    expect(context).toEqual({ enterpriseId: "ent-x", uid: "u-x" });
  });
});
