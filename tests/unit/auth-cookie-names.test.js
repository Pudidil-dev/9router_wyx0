import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const ORIGINAL_ENV = { ...process.env };

vi.mock("@/lib/dataDir", () => ({
  DATA_DIR: "D:/tmp/9router-tests",
}));

vi.mock("@/lib/localDb", () => ({
  getSettings: vi.fn(async () => ({})),
}));

async function importDashboardSession(env = {}) {
  vi.resetModules();
  process.env = { ...ORIGINAL_ENV, JWT_SECRET: "test-secret-for-cookie-name-tests", ...env };
  return await import("../../src/lib/auth/dashboardSession.js");
}

async function importOidc(env = {}) {
  vi.resetModules();
  process.env = { ...ORIGINAL_ENV, ...env };
  return await import("../../src/lib/auth/oidc.js");
}

describe("auth cookie names", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env = { ...ORIGINAL_ENV, JWT_SECRET: "test-secret-for-cookie-name-tests" };
  });

  afterEach(() => {
    vi.resetModules();
    process.env = { ...ORIGINAL_ENV };
  });

  it("uses auth_token by default", async () => {
    delete process.env.AUTH_TOKEN_COOKIE_NAME;
    const { AUTH_TOKEN_COOKIE } = await importDashboardSession(process.env);

    expect(AUTH_TOKEN_COOKIE).toBe("auth_token");
  });

  it("uses AUTH_TOKEN_COOKIE_NAME when configured", async () => {
    const { AUTH_TOKEN_COOKIE } = await importDashboardSession({ AUTH_TOKEN_COOKIE_NAME: "wyx_auth_token" });

    expect(AUTH_TOKEN_COOKIE).toBe("wyx_auth_token");
  });

  it("sets and clears the configured dashboard auth cookie", async () => {
    const { AUTH_TOKEN_COOKIE, clearDashboardAuthCookie, setDashboardAuthCookie } = await importDashboardSession({
      AUTH_TOKEN_COOKIE_NAME: "wyx_auth_token",
      JWT_SECRET: "test-secret-for-cookie-name-tests",
    });
    const cookieStore = { set: vi.fn(), delete: vi.fn() };

    await setDashboardAuthCookie(cookieStore, new Request("http://localhost/dashboard"));
    clearDashboardAuthCookie(cookieStore);

    expect(AUTH_TOKEN_COOKIE).toBe("wyx_auth_token");
    expect(cookieStore.set).toHaveBeenCalledWith(
      "wyx_auth_token",
      expect.any(String),
      expect.objectContaining({ httpOnly: true, sameSite: "lax", path: "/" }),
    );
    expect(cookieStore.delete).toHaveBeenCalledWith("wyx_auth_token");
  });

  it("uses default OIDC cookie names", async () => {
    delete process.env.OIDC_STATE_COOKIE_NAME;
    delete process.env.OIDC_NONCE_COOKIE_NAME;
    delete process.env.OIDC_VERIFIER_COOKIE_NAME;
    const { OIDC_COOKIE_NAMES } = await importOidc(process.env);

    expect(OIDC_COOKIE_NAMES).toEqual({
      state: "oidc_state",
      nonce: "oidc_nonce",
      verifier: "oidc_code_verifier",
    });
  });

  it("uses configured OIDC cookie names", async () => {
    const { OIDC_COOKIE_NAMES } = await importOidc({
      OIDC_STATE_COOKIE_NAME: "wyx_oidc_state",
      OIDC_NONCE_COOKIE_NAME: "wyx_oidc_nonce",
      OIDC_VERIFIER_COOKIE_NAME: "wyx_oidc_code_verifier",
    });

    expect(OIDC_COOKIE_NAMES).toEqual({
      state: "wyx_oidc_state",
      nonce: "wyx_oidc_nonce",
      verifier: "wyx_oidc_code_verifier",
    });
  });
});
