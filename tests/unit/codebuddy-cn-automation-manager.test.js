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
    expect(__test__.splitCodeBuddyCnPhoneForLogin("+852 5355 2982")).toEqual({
      dialCode: "+852",
      localNumber: "53552982",
      fullNumber: "+85253552982",
    });
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
