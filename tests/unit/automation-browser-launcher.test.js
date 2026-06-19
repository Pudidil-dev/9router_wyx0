import { describe, expect, it, vi } from "vitest";
import {
  AUTOMATION_BROWSER_GOOGLE_CHROME,
  AUTOMATION_BROWSER_OPTIONS,
  DEFAULT_AUTOMATION_BROWSER,
  normalizeAutomationBrowser,
} from "../../src/shared/constants/automationBrowsers.js";

const launch = vi.fn(async (options) => ({ options }));

vi.mock("playwright", () => ({
  chromium: {
    launch,
  },
}));

describe("automation browser options", () => {
  it("exposes Google Chrome as a selectable automation browser", () => {
    expect(AUTOMATION_BROWSER_OPTIONS).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: AUTOMATION_BROWSER_GOOGLE_CHROME,
          label: "Google Chrome",
        }),
      ])
    );
    expect(normalizeAutomationBrowser("google-chrome")).toBe(AUTOMATION_BROWSER_GOOGLE_CHROME);
    expect(DEFAULT_AUTOMATION_BROWSER).toBe(AUTOMATION_BROWSER_GOOGLE_CHROME);
  });

  it("launches installed Google Chrome through Playwright channel chrome", async () => {
    const { createAutomationBrowserLauncher } = await import("../../src/lib/oauth/services/automationBrowserLauncher.js");
    const launcher = createAutomationBrowserLauncher(AUTOMATION_BROWSER_GOOGLE_CHROME, { headless: false });

    await launcher();

    expect(launch).toHaveBeenCalledWith({
      channel: "chrome",
      headless: false,
      args: [
        "--disable-blink-features=AutomationControlled",
        "--disable-infobars",
        "--no-sandbox",
        "--disable-dev-shm-usage",
        "--disable-features=PrivateNetworkAccessRespectPreflightResults,PrivateNetworkAccessSendPreflights,BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessPromptForUnsureBlocked,TranslateUI,OptimizationHints",
      ],
    });
  });
});
