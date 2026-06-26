import { describe, expect, it, vi } from "vitest";
import {
  __test__,
  CodeBuddyCnAutomationManager,
} from "../../src/lib/oauth/services/codebuddyCnAutomationManager.js";

describe("CodeBuddy CN automation manager helpers", () => {
  it("parses credential objects and count-based placeholders", () => {
    const parsedObject = __test__.parseCodeBuddyCnAutomationAccounts([
      {
        email: "user@example.com",
        accessToken: "access-token",
      },
    ]);

    expect(parsedObject.invalidLines).toEqual([]);
    expect(parsedObject.parsed[0]).toMatchObject({
      email: "user@example.com",
      accessToken: "access-token",
      hasCredentials: true,
    });

    const parsedCount = __test__.parseCodeBuddyCnAutomationAccounts([], 2);
    expect(parsedCount.parsed).toHaveLength(2);
    expect(parsedCount.parsed[0].label).toBe("Account 1");
    expect(parsedCount.parsed[1].label).toBe("Account 2");
  });

  it("builds lookup response with recoverable flag for active jobs", () => {
    const response = __test__.buildLookupResponse({
      jobId: "cbcn-1",
      status: "running",
    });

    expect(response.found).toBe(true);
    expect(response.recoverable).toBe(true);
    expect(response.job.jobId).toBe("cbcn-1");
  });

  it("normalizes phone numbers and extracts OTP codes", () => {
    expect(__test__.normalizePhoneNumber("852 9123 4567")).toBe("+85291234567");
    expect(__test__.normalizePhoneNumber("+852 9123 4567")).toBe("+85291234567");
    expect(__test__.extractOtpCodeFromText("Your CodeBuddy code is 483920")).toBe("483920");
    expect(__test__.extractOtpCodeFromText("no code here")).toBe("");
  });

  it("resolves 5sim order config from account-specific overrides", () => {
    const config = __test__.getFiveSimOrderConfig({
      options: {
        fiveSimCountry: "hongkong",
        fiveSimOperator: "any",
        fiveSimProduct: "other",
      },
    }, {
      fiveSimCountry: "indonesia",
      fiveSimOperator: "telkomsel",
      fiveSimProduct: "wechat",
    });

    expect(config).toEqual({
      country: "indonesia",
      operator: "telkomsel",
      product: "wechat",
    });
  });

  it("defaults automatic SMS registration to enow's HK 5sim route", () => {
    expect(__test__.getFiveSimOrderConfig({ options: {} }, {})).toEqual({
      country: "hongkong",
      operator: "virtual54",
      product: "codebuddy",
    });
  });

  it("selects the recovered CodeBuddy CN mainland region after login", async () => {
    const selectOption = vi.fn(async () => undefined);
    const click = vi.fn(async () => undefined);
    const page = {
      locator: vi.fn((selector) => {
        if (selector.includes("region-select")) {
          return { count: async () => 1, selectOption };
        }
        return { count: async () => 1, first: () => ({ click }) };
      }),
      waitForTimeout: vi.fn(async () => undefined),
    };

    const result = await __test__.selectCodeBuddyCnRegion(page);

    expect(result).toEqual({ selected: true, region: "china-mainland" });
    expect(selectOption).toHaveBeenCalledWith("china-mainland");
    expect(click).toHaveBeenCalledOnce();
  });

  it("infers one automation slot when only 5sim api key is provided", () => {
    expect(__test__.getEffectiveAutomationCount({
      accounts: [],
      count: 0,
      fiveSimApiKey: "five-sim-token",
    })).toBe(1);

    expect(__test__.getEffectiveAutomationCount({
      accounts: ["someone@example.com"],
      count: 0,
      fiveSimApiKey: "five-sim-token",
    })).toBe(0);
  });

  it("starts a manual sandbox login as a headful, single-account job", async () => {
    let resolveLaunch;
    const launchOptions = new Promise((resolve) => { resolveLaunch = resolve; });
    const browserLauncher = async (_browser, options) => {
      resolveLaunch(options);
      throw new Error("stop after launch"); // short-circuit runJob for the test
    };
    const manager = new CodeBuddyCnAutomationManager({
      browserLauncher,
      saveConnection: vi.fn(),
      storageName: "codebuddy-cn-manual-sandbox-test",
    });

    const job = await manager.startManualSandboxLogin({ name: "My Manual Login" });

    // The visible window is what makes manual login possible.
    expect(await launchOptions).toEqual({ headless: false });

    const internal = manager.jobs.get(job.jobId);
    expect(internal.mode).toBe("manual_sandbox");
    expect(internal.headless).toBe(false);
    expect(internal.options.manual).toBe(true);
    expect(internal.options.fiveSimApiKey).toBe("");
    expect(internal.accounts).toHaveLength(1);
    expect(internal.accounts[0].label).toBe("My Manual Login");
    expect(internal.accounts[0].hasCredentials).toBe(false);
  });

  it("finishes an authenticated account in enow lifecycle order", async () => {
    const order = [];
    const lifecycleRunner = vi.fn(async ({ beforeActivation }) => {
      order.push("gateway");
      await beforeActivation();
      order.push("activation");
      return {
        activation: { status: "activated", method: "browser" },
        gateway: { authenticated: true, blocked: false, probation: false, message: "" },
      };
    });
    const createApiKey = vi.fn(async () => {
      order.push("api-key");
      return "cbcn-api-key";
    });
    const usageLoader = vi.fn(async () => {
      order.push("quota");
      return {
        providerSpecificDataPatch: {
          codebuddyCnCreditLimit: 100,
        },
      };
    });
    const saveConnection = vi.fn(async (account) => {
      order.push("save");
      expect(account.providerSpecificData).toMatchObject({
        activationStatus: "activated",
        activationMethod: "browser",
        gatewayAuthenticated: true,
        gatewayBlocked: false,
        gatewayProbation: false,
      });
      return { connection: { id: "cbcn-connection" } };
    });
    const manager = new CodeBuddyCnAutomationManager({
      lifecycleRunner,
      createApiKey,
      usageLoader,
      saveConnection,
      storageName: "codebuddy-cn-lifecycle-order-test",
    });
    const account = {
      accessToken: "",
      apiKey: "",
      providerSpecificData: {},
      logs: [],
    };

    const result = await manager.finishAuthenticatedAccount({
      job: { cancelRequested: false, options: {} },
      account,
      page: {},
      extracted: { accessToken: "access-token", cookiesJson: "[]" },
    });

    expect(order).toEqual(["api-key", "gateway", "quota", "activation", "save"]);
    expect(account.providerSpecificData.codebuddyCnCreditLimit).toBe(100);
    expect(result.connection.id).toBe("cbcn-connection");
  });

  it("does not save a connection when cancellation arrives during lifecycle checks", async () => {
    const job = { cancelRequested: false, options: {} };
    const saveConnection = vi.fn();
    const manager = new CodeBuddyCnAutomationManager({
      lifecycleRunner: vi.fn(async ({ beforeActivation }) => {
        await beforeActivation();
        job.cancelRequested = true;
        return {
          activation: { status: "activation_skipped", error: "cancelled" },
          gateway: { authenticated: false, blocked: false, probation: true, message: "probation" },
        };
      }),
      createApiKey: vi.fn(async () => "late-api-key"),
      usageLoader: vi.fn(async () => null),
      saveConnection,
      storageName: "codebuddy-cn-lifecycle-cancel-test",
    });

    await expect(manager.finishAuthenticatedAccount({
      job,
      account: { providerSpecificData: {}, logs: [] },
      page: {},
      extracted: { accessToken: "access-token" },
    })).rejects.toThrow("Job cancelled");

    expect(saveConnection).not.toHaveBeenCalled();
  });

  // Simulates a single input element. `fillWorks` / `setterWorks` / `keyboardWorks`
  // model which fill strategy actually registers a value on a controlled input —
  // a real React/Vue input swallows naive `.value =` assignment, so only some of
  // these are effective depending on the framework.
  function makeInputTarget({
    fillWorks = false,
    setterWorks = false,
    keyboardWorks = false,
    visible = true,
    exists = true,
  } = {}) {
    const stored = { value: "" };
    const single = {
      count: async () => (exists ? 1 : 0),
      isVisible: async () => visible,
      fill: async (value) => {
        if (fillWorks) stored.value = value;
      },
      inputValue: async () => stored.value,
      click: async () => undefined,
      press: async () => undefined,
      pressSequentially: async (value) => {
        if (keyboardWorks) stored.value = value;
      },
      type: async (value) => {
        if (keyboardWorks) stored.value = value;
      },
    };
    return {
      stored,
      locator: () => ({ first: () => single }),
      // The prototype-setter strategy runs inside evaluate; model whether it took.
      evaluate: async (_fn, arg) => {
        if (setterWorks && arg && typeof arg.val === "string") stored.value = arg.val;
        return undefined;
      },
    };
  }

  it("fills via Playwright native fill when the input accepts it", async () => {
    const target = makeInputTarget({ fillWorks: true });
    const ok = await __test__.fillInputReliably(target, ["#code"], "483920");
    expect(ok).toBe(true);
    expect(target.stored.value).toBe("483920");
  });

  it("falls back to the prototype value setter for controlled inputs", async () => {
    const target = makeInputTarget({ fillWorks: false, setterWorks: true });
    const ok = await __test__.fillInputReliably(target, ["#code"], "483920");
    expect(ok).toBe(true);
    expect(target.stored.value).toBe("483920");
  });

  it("falls back to real keyboard typing when value assignment is swallowed", async () => {
    const target = makeInputTarget({ fillWorks: false, setterWorks: false, keyboardWorks: true });
    const ok = await __test__.fillInputReliably(target, ["#code"], "483920");
    expect(ok).toBe(true);
    expect(target.stored.value).toBe("483920");
  });

  it("reports failure (instead of a false success) when no strategy registers the value", async () => {
    // This is the regression: the old fill returned true whenever the element
    // existed, so a swallowed OTP looked submitted and the job hung until timeout.
    const target = makeInputTarget({ fillWorks: false, setterWorks: false, keyboardWorks: false });
    const ok = await __test__.fillInputReliably(target, ["#code"], "483920");
    expect(ok).toBe(false);
    expect(target.stored.value).toBe("");
  });

  it("strips non-digits before filling the OTP input", async () => {
    const target = makeInputTarget({ fillWorks: true });
    const ok = await __test__.fillOtpInput(target, "code: 4 8 3 9 2 0");
    expect(ok).toBe(true);
    expect(target.stored.value).toBe("483920");
  });

  it("treats a populated /console/accounts response as a confirmed login", async () => {
    const page = {
      evaluate: async () => ({
        status: 200,
        text: "",
        json: { code: 0, data: { accounts: [{ userEnterpriseId: "ent-1", uid: "u-1" }] } },
      }),
    };
    const context = await __test__.fetchCodeBuddyCnAccountContext(page);
    expect(context).toEqual({ loggedIn: true, enterpriseId: "ent-1", uid: "u-1" });
  });

  it("treats an empty /console/accounts response as not-yet-logged-in", async () => {
    const page = {
      evaluate: async () => ({ status: 200, text: "", json: { code: 0, data: { accounts: [] } } }),
    };
    const context = await __test__.fetchCodeBuddyCnAccountContext(page);
    expect(context.loggedIn).toBe(false);
    expect(context.enterpriseId).toBe("personal-edition-user-id");
  });

  it("accepts the Terms/Privacy consent across the page and every frame", async () => {
    const visited = [];
    const makeTarget = (name, result) => ({
      evaluate: async () => {
        visited.push(name);
        return result;
      },
    });
    const frameWithModal = makeTarget("frame", true);
    const page = {
      evaluate: async () => {
        visited.push("page");
        return false;
      },
      frames: () => [frameWithModal],
    };

    const acted = await __test__.acceptCodeBuddyCnAgreement(page);

    expect(acted).toBe(true);
    expect(visited).toEqual(["page", "frame"]);
  });

  it("returns the frame that actually exposes phone/OTP inputs as the login surface", async () => {
    const frameNoInputs = { evaluate: async () => false };
    const frameWithInputs = { evaluate: async () => true };
    const page = {
      frames: () => [frameNoInputs, frameWithInputs],
      evaluate: async () => false,
    };

    const surface = await __test__.findCodeBuddyCnAuthSurface(page);
    expect(surface).toBe(frameWithInputs);
  });

  it("returns null when no surface exposes phone/OTP inputs", async () => {
    const page = {
      frames: () => [{ evaluate: async () => false }],
      evaluate: async () => false,
    };
    expect(await __test__.findCodeBuddyCnAuthSurface(page)).toBeNull();
  });

  it("detects the CodeBuddy CN access-restricted interstitial", async () => {
    const original = globalThis.document;
    const page = { evaluate: async (fn) => fn() };
    try {
      globalThis.document = { body: { innerText: "账号访问受限，请稍后再试" } };
      expect(await __test__.isCodeBuddyCnRestricted(page)).toBe(true);

      globalThis.document = { body: { innerText: "Account Access Restricted" } };
      expect(await __test__.isCodeBuddyCnRestricted(page)).toBe(true);

      globalThis.document = { body: { innerText: "欢迎使用 CodeBuddy" } };
      expect(await __test__.isCodeBuddyCnRestricted(page)).toBe(false);
    } finally {
      globalThis.document = original;
    }
  });

  it("preserves activation and gateway metadata during the first credit refresh", () => {
    const merged = __test__.mergeCodeBuddyCnUsageMetadata({
      activationStatus: "activated",
      gatewayProbation: true,
      gatewayMessage: "probation",
    }, {
      providerSpecificDataPatch: {
        activationStatus: "stale-overwrite",
        gatewayProbation: false,
        codebuddyCnCreditLimit: 100,
      },
    });

    expect(merged).toMatchObject({
      activationStatus: "activated",
      gatewayProbation: true,
      gatewayMessage: "probation",
      codebuddyCnCreditLimit: 100,
    });
  });
});
