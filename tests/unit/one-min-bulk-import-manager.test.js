import { describe, expect, it } from "vitest";
import {
  OneMinBulkImportManager,
  __testables,
  runOneMinAccountAutomation,
} from "../../src/lib/oauth/services/oneMinBulkImportManager.js";

function createFakeBrowser() {
  let apiPageOpen = false;
  let apiKeyCreateCount = 0;
  let apiCreditIntroOpen = false;
  const fakePage = {
    on() {},
    off() {},
    async evaluate(fn) {
      if (String(fn).includes("document.body")) {
        if (!apiPageOpen) return "";
        const keys = [];
        for (let index = 0; index < apiKeyCreateCount; index += 1) {
          keys.push(`${String(index + 1).padStart(64, "a")}`.slice(0, 64));
        }
        return `🎮 API key list API Docs New API Key ${keys.join(" ")}`;
      }
      return {
        currentTeamId: "team-test",
        token: "web-session-token",
        currentUser: {
          email: "stub@example.com",
          uuid: "user-test",
        },
        currentTeam: {
          uuid: "team-test",
          name: "Stub Team",
        },
      };
    },
    async goto(url) {
      apiPageOpen = url === "https://app.1min.ai/api";
      apiCreditIntroOpen = apiPageOpen;
    },
    locator(selector) {
      return {
        first() { return this; },
        async count() {
          if (!apiPageOpen) return 0;
          if (apiCreditIntroOpen && (selector.includes("modal-close") || selector.includes("Close") || selector.includes("close"))) return 1;
          if (apiCreditIntroOpen) return 0;
          return selector.includes("New API Key") ? 1 : 0;
        },
        async isVisible() { return (await this.count()) > 0; },
        async isEnabled() { return true; },
        async click() {
          if (apiCreditIntroOpen) {
            apiCreditIntroOpen = false;
            return;
          }
          apiKeyCreateCount += 1;
        }
      };
    },
    async waitForTimeout() {},
    url() {
      return apiPageOpen ? "https://app.1min.ai/api" : "about:blank";
    },
    bringToFront: async () => null,
    context() {
      return {};
    },
  };

  return {
    async newContext() {
      return {
        async newPage() {
          return fakePage;
        },
        on() {},
        off() {},
        async close() {
          return null;
        },
      };
    },
    async close() {
      return null;
    },
  };
}

async function waitFor(fn, timeoutMs = 3000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = fn();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Timed out waiting for condition");
}

describe("OneMinBulkImportManager", () => {
  it("closes the 1min intro modal before Google login", async () => {
    const actions = [];
    let introVisible = true;
    let loginModalVisible = false;
    let googleStep = null;
    let resolveSuccess;
    const successPromise = new Promise((resolve) => {
      resolveSuccess = resolve;
    });

    const isSelectorVisible = (selector) => {
      if (selector.includes(".ant-tour-close")) {
        return introVisible;
      }
      if (selector.includes("Google")) {
        return loginModalVisible && !googleStep;
      }
      if (selector.includes("Log In") || selector.includes("Login")) {
        return !introVisible && !loginModalVisible && !googleStep;
      }
      if (selector.includes("type='email'") || selector.includes("identifierId")) {
        return googleStep === "email";
      }
      if (selector.includes("type='password'")) {
        return googleStep === "password";
      }
      if (selector.includes("identifierNext")) return googleStep === "email";
      if (selector.includes("passwordNext")) return googleStep === "password";
      return false;
    };

    const createLocator = (selector) => ({
      first() {
        return this;
      },
      async count() {
        return isSelectorVisible(selector) ? 1 : 0;
      },
      async isVisible() {
        return isSelectorVisible(selector);
      },
      async isEnabled() {
        return true;
      },
      async click() {
        if (selector.includes(".ant-tour-close")) {
          introVisible = false;
          actions.push("close-intro");
          return;
        }
        if (selector.includes("Google")) {
          googleStep = "email";
          actions.push("select-google");
          return;
        }
        if (selector.includes("Log In") || selector.includes("Login")) {
          loginModalVisible = true;
          actions.push("open-login");
          return;
        }
        if (selector.includes("identifierNext")) {
          googleStep = "password";
          actions.push("submit-google-email");
          return;
        }
        if (selector.includes("passwordNext")) {
          googleStep = "done";
          actions.push("submit-google-password");
          resolveSuccess({ authState: { currentTeamId: "team-test" } });
        }
      },
      async fill(value) {
        actions.push(selector.includes("password") ? `google-password:${Boolean(value)}` : `google-email:${value}`);
      },
      async press() {
        actions.push("submit-enter");
      },
    });

    const result = await runOneMinAccountAutomation({
      page: {
        async goto() {
          actions.push("goto");
        },
        async waitForTimeout() {
          return null;
        },
        url() {
          return googleStep ? "https://accounts.google.com/v3/signin" : "https://app.1min.ai/";
        },
        locator: createLocator,
        async evaluate() {
          return "";
        },
      },
      email: "user@example.com",
      password: "secret",
      successPromise,
    });

    expect(result.status).toBe("success");
    expect(actions).toEqual([
      "goto",
      "close-intro",
      "open-login",
      "select-google",
      "google-email:user@example.com",
      "submit-google-email",
      "google-password:true",
      "submit-google-password",
    ]);
  });

  it("does not close the login dialog after the Google button is visible", async () => {
    const actions = [];
    let loginModalVisible = true;
    let googleStep = null;
    let resolveSuccess;
    const successPromise = new Promise((resolve) => {
      resolveSuccess = resolve;
    });

    const isSelectorVisible = (selector) => {
      if (selector.includes(".ant-tour-close")) return true;
      if (selector.includes("Google")) return loginModalVisible && !googleStep;
      if (selector.includes("Log In") || selector.includes("Login")) return false;
      if (selector.includes("type='email'") || selector.includes("identifierId")) return googleStep === "email";
      if (selector.includes("type='password'")) return googleStep === "password";
      if (selector.includes("identifierNext")) return googleStep === "email";
      if (selector.includes("passwordNext")) return googleStep === "password";
      return false;
    };

    const createLocator = (selector) => ({
      first() {
        return this;
      },
      async count() {
        return isSelectorVisible(selector) ? 1 : 0;
      },
      async isVisible() {
        return isSelectorVisible(selector);
      },
      async isEnabled() {
        return true;
      },
      async click() {
        if (selector.includes(".ant-tour-close")) {
          actions.push("close-intro");
          return;
        }
        if (selector.includes("Google")) {
          actions.push("select-google");
          googleStep = "email";
          return;
        }
        if (selector.includes("identifierNext")) {
          actions.push("submit-google-email");
          googleStep = "password";
          return;
        }
        if (selector.includes("passwordNext")) {
          actions.push("submit-google-password");
          resolveSuccess({ authState: { currentTeamId: "team-test" } });
        }
      },
      async fill(value) {
        actions.push(selector.includes("password") ? `google-password:${Boolean(value)}` : `google-email:${value}`);
      },
      async press() {
        actions.push("submit-enter");
      },
    });

    const result = await runOneMinAccountAutomation({
      page: {
        async goto() {
          actions.push("goto");
        },
        async waitForTimeout() {
          return null;
        },
        url() {
          return googleStep ? "https://accounts.google.com/v3/signin" : "https://app.1min.ai/";
        },
        locator: createLocator,
        async evaluate() {
          return "";
        },
      },
      email: "user@example.com",
      password: "secret",
      successPromise,
    });

    expect(result.status).toBe("success");
    expect(actions).toEqual([
      "goto",
      "select-google",
      "google-email:user@example.com",
      "submit-google-email",
      "google-password:true",
      "submit-google-password",
    ]);
  });

  it("drives Google login when 1min opens OAuth in a popup page", async () => {
    const actions = [];
    let popupStep = "email";
    let resolveSuccess;
    const successPromise = new Promise((resolve) => {
      resolveSuccess = resolve;
    });

    const createLocator = (pageName, selector) => ({
      first() {
        return this;
      },
      async count() {
        if (pageName === "main") return selector.includes("Google") ? 1 : 0;
        if (selector.includes("type='email'") || selector.includes("identifierId")) return popupStep === "email" ? 1 : 0;
        if (selector.includes("type='password'")) return popupStep === "password" ? 1 : 0;
        if (selector.includes("identifierNext")) return popupStep === "email" ? 1 : 0;
        if (selector.includes("passwordNext")) return popupStep === "password" ? 1 : 0;
        return 0;
      },
      async isVisible() {
        return (await this.count()) > 0;
      },
      async isEnabled() {
        return true;
      },
      async click() {
        if (pageName === "main" && selector.includes("Google")) {
          actions.push("select-google-main");
          return;
        }
        if (selector.includes("identifierNext")) {
          popupStep = "password";
          actions.push("submit-popup-email");
          return;
        }
        if (selector.includes("passwordNext")) {
          actions.push("submit-popup-password");
          resolveSuccess({ authState: { currentTeamId: "team-popup" } });
        }
      },
      async fill(value) {
        actions.push(selector.includes("password") ? `popup-password:${Boolean(value)}` : `popup-email:${value}`);
      },
    });

    const googlePage = {
      url: () => "https://accounts.google.com/v3/signin",
      locator: (selector) => createLocator("popup", selector),
      async bringToFront() {
        actions.push("bring-popup-front");
      },
      async waitForTimeout() {},
      async evaluate() {
        return "";
      },
    };
    const mainPage = {
      async goto() {
        actions.push("goto-main");
      },
      async waitForTimeout() {},
      url: () => "https://app.1min.ai/",
      locator: (selector) => createLocator("main", selector),
      context: () => ({ pages: () => [mainPage, googlePage] }),
      async evaluate() {
        return "";
      },
    };

    const result = await runOneMinAccountAutomation({
      page: mainPage,
      email: "user@example.com",
      password: "secret",
      successPromise,
    });

    expect(result.status).toBe("success");
    expect(actions).toContain("select-google-main");
    expect(actions).toContain("popup-email:user@example.com");
    expect(actions).toContain("popup-password:true");
  });

  it("runs bulk Google accounts and saves 1min AI API key connections", async () => {
    const saved = [];
    const manager = new OneMinBulkImportManager({
      browserLauncher: async () => createFakeBrowser(),
      saveConnection: async ({ tokens, email }) => {
        saved.push({ tokens, email });
        return {
          connection: { id: `conn-${email}` },
        };
      },
      googleAutomation: async ({ successPromise }) => ({
        status: "success",
        ...(await successPromise),
      }),
    });

    const startedJob = await manager.startJob({
      accounts: [
        "user1@example.com|pw1",
        "user2@example.com|pw2",
      ],
      concurrency: 2,
    });

    const finishedJob = await waitFor(() => {
      const job = manager.getJob(startedJob.jobId);
      return job && job.status === "completed" ? job : null;
    });

    expect(finishedJob.summary.success).toBe(2);
    expect(saved.map((entry) => entry.email).sort()).toEqual([
      "user1@example.com",
      "user2@example.com",
    ]);
    expect(saved.map((entry) => entry.tokens.apiKey).sort()).toEqual([
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1",
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa2",
    ]);
    expect(saved.map((entry) => entry.tokens.accessToken).sort()).toEqual([
      "web-session-token",
      "web-session-token",
    ]);
    expect(saved.every((entry) => entry.tokens.providerSpecificData.authKind === "api_key")).toBe(true);
    expect(saved.every((entry) => entry.tokens.providerSpecificData.teamId === "team-test")).toBe(true);
    expect(finishedJob.accounts.every((account) => account.connectionId)).toBe(true);
  });

  it("extracts nested 1min auth state from arbitrary browser storage payloads", async () => {
    const authState = await __testables.readOneMinAuthStateFromPage({
      async evaluate(fn) {
        const storagePayload = JSON.stringify({
          app: {
            session: {
              auth: {
                accessToken: "nested-web-session-token",
                currentUser: {
                  email: "user@example.com",
                  id: "user-1",
                  teams: [{ team: { id: "team-1", name: "Default" } }],
                },
                currentTeam: { id: "team-1" },
              },
            },
          },
        });

        const storage = {
          length: 1,
          key: () => "zustand-auth",
          getItem: () => storagePayload,
        };

        globalThis.window = {
          localStorage: storage,
          sessionStorage: { length: 0, key: () => null, getItem: () => null },
        };
        globalThis.indexedDB = {};
        try {
          return await fn();
        } finally {
          delete globalThis.window;
          delete globalThis.indexedDB;
        }
      },
    });

    expect(authState.currentTeamId).toBe("team-1");
    expect(authState.token).toBe("nested-web-session-token");
    expect(authState.currentUser.email).toBe("user@example.com");
  });
});
