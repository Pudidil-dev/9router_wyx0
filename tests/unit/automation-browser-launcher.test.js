import { describe, expect, it, vi } from "vitest";
import {
  AUTOMATION_BROWSER_GOOGLE_CHROME,
  AUTOMATION_BROWSER_OPTIONS,
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
  });

  it("launches installed Google Chrome through Playwright channel chrome", async () => {
    const { createAutomationBrowserLauncher } = await import("../../src/lib/oauth/services/automationBrowserLauncher.js");
    const launcher = createAutomationBrowserLauncher(AUTOMATION_BROWSER_GOOGLE_CHROME, { headless: false });

    await launcher();

    expect(launch).toHaveBeenCalledWith({
      channel: "chrome",
      headless: false,
      ignoreDefaultArgs: ["--enable-automation"],
      args: [
        "--disable-blink-features=AutomationControlled",
        "--disable-infobars",
        "--no-default-browser-check",
        "--no-first-run",
      ],
    });
  });
});

describe("automation browser contexts", () => {
  it("does not force a stale user-agent override for Google Chrome", async () => {
    const { createFreshContext } = await import("../../src/lib/oauth/services/kiroBulkImportManager.js");
    const newContext = vi.fn(async () => ({
      addInitScript: vi.fn(async () => null),
      newPage: vi.fn(async () => ({})),
    }));

    await createFreshContext({ newContext }, { browserChoice: AUTOMATION_BROWSER_GOOGLE_CHROME });

    expect(newContext).toHaveBeenCalledWith(expect.not.objectContaining({
      userAgent: expect.any(String),
    }));
  });
});
