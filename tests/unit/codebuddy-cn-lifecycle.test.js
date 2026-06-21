import { describe, expect, it, vi } from "vitest";
import {
  runCodeBuddyCnLifecycle,
} from "../../src/lib/oauth/services/codebuddyCnLifecycle.js";

describe("CodeBuddy CN account lifecycle", () => {
  it("skips activation for an already active account and preserves gateway status", async () => {
    const request = vi.fn(async ({ url }) => {
      if (url.endsWith("/api/v1/userinfo")) {
        return { status: 200, json: { is_activated: true, credits: 100 } };
      }
      if (url.endsWith("/api/gateway/status")) {
        return { status: 200, json: { authenticated: true, blocked: false, probation: false } };
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    const activateInBrowser = vi.fn();

    const result = await runCodeBuddyCnLifecycle({
      page: {},
      accessToken: "access-token",
      request,
      activateInBrowser,
    });

    expect(activateInBrowser).not.toHaveBeenCalled();
    expect(result.activation).toMatchObject({ status: "already_active" });
    expect(result.gateway).toMatchObject({ authenticated: true, blocked: false, probation: false });
  });

  it("attempts browser activation before the API fallback", async () => {
    const order = [];
    const request = vi.fn(async ({ url, method }) => {
      if (url.endsWith("/api/v1/userinfo")) {
        return { status: 200, json: { is_activated: false, credits: 0 } };
      }
      if (url.includes("/user/buy/activation") && method === "POST") {
        order.push("api");
        return { status: 200, json: { success: true } };
      }
      if (url.endsWith("/api/gateway/status")) {
        order.push("gateway");
        return { status: 200, json: { authenticated: true } };
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    const activateInBrowser = vi.fn(async () => {
      order.push("browser");
      return { success: false, error: "activation page did not redirect" };
    });

    const result = await runCodeBuddyCnLifecycle({
      page: {},
      accessToken: "access-token",
      inviteCode: "invite-1",
      request,
      activateInBrowser,
    });

    expect(order).toEqual(["gateway", "browser", "api"]);
    expect(result.activation).toMatchObject({ status: "activated", method: "api" });
  });

  it("records activation_skipped without discarding valid credentials", async () => {
    const request = vi.fn(async ({ url }) => {
      if (url.endsWith("/api/v1/userinfo")) throw new Error("userinfo unavailable");
      if (url.includes("/user/buy/activation")) return { status: 503, text: "unavailable" };
      if (url.endsWith("/api/gateway/status")) return { status: 200, json: { authenticated: true } };
      throw new Error(`Unexpected request: ${url}`);
    });

    const result = await runCodeBuddyCnLifecycle({
      page: {},
      accessToken: "access-token",
      request,
      activateInBrowser: vi.fn(async () => ({ success: false, error: "page unavailable" })),
    });

    expect(result.activation.status).toBe("activation_skipped");
    expect(result.activation.error).toContain("unavailable");
    expect(result.gateway.authenticated).toBe(true);
  });

  it("maps gateway request failures to enow probation metadata", async () => {
    const request = vi.fn(async ({ url }) => {
      if (url.endsWith("/api/v1/userinfo")) return { status: 200, json: { is_activated: true } };
      if (url.endsWith("/api/gateway/status")) throw new Error("gateway unavailable");
      throw new Error(`Unexpected request: ${url}`);
    });

    const result = await runCodeBuddyCnLifecycle({
      page: {},
      accessToken: "access-token",
      request,
    });

    expect(result.gateway).toMatchObject({
      authenticated: false,
      blocked: false,
      probation: true,
    });
    expect(result.gateway.message).toContain("probation");
  });
});
