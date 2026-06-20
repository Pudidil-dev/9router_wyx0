import { describe, expect, it } from "vitest";
import { __test__ } from "../../src/lib/oauth/services/codebuddyCnAutomationManager.js";

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
});
