import { describe, expect, it, vi } from "vitest";
import {
  AUTOMATION_BROWSER_CAMOFOX,
  AUTOMATION_BROWSER_OPTIONS,
  DEFAULT_AUTOMATION_BROWSER,
  normalizeAutomationBrowser,
} from "../../src/shared/constants/automationBrowsers.js";

const Camoufox = vi.fn(async (options) => ({ options }));

vi.mock("camoufox-js", () => ({ Camoufox }));

describe("automation browser runtime", () => {
  it("exposes Camoufox as the sole automation browser", () => {
    expect(AUTOMATION_BROWSER_OPTIONS).toEqual([
      expect.objectContaining({
        id: AUTOMATION_BROWSER_CAMOFOX,
        label: "Camoufox",
      }),
    ]);
    expect(normalizeAutomationBrowser("google-chrome")).toBe(AUTOMATION_BROWSER_CAMOFOX);
    expect(normalizeAutomationBrowser("playwright-chromium")).toBe(AUTOMATION_BROWSER_CAMOFOX);
    expect(DEFAULT_AUTOMATION_BROWSER).toBe(AUTOMATION_BROWSER_CAMOFOX);
  });

  it("launches headless Camoufox for legacy browser selections", async () => {
    const { createAutomationBrowserLauncher } = await import("../../src/lib/oauth/services/automationBrowserLauncher.js");
    const launcher = createAutomationBrowserLauncher("google-chrome", { headless: true });

    await launcher();

    const expectedOs = process.platform === "win32" ? "windows" : process.platform === "darwin" ? "macos" : "linux";
    expect(Camoufox).toHaveBeenCalledWith({
      headless: true,
      os: expectedOs,
      block_webrtc: true,
      humanize: false,
    });
  });
});
