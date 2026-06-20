import {
  AUTOMATION_BROWSER_CAMOFOX,
  normalizeAutomationBrowser,
} from "@/shared/constants/automationBrowsers";

function getHostFingerprintOs() {
  if (process.platform === "win32") return "windows";
  if (process.platform === "darwin") return "macos";
  return "linux";
}

async function launchCamoufox({ headless = true } = {}) {
  const { Camoufox } = await import("camoufox-js");
  return await Camoufox({
    headless,
    os: getHostFingerprintOs(),
    block_webrtc: true,
    humanize: false,
  });
}

/**
 * Camoufox is the sole automation runtime. The browser argument is accepted so
 * legacy jobs and stored settings remain compatible while migrating to Camoufox.
 */
export function createAutomationBrowserLauncher(browser, options = {}) {
  normalizeAutomationBrowser(browser);
  const launchOptions = { headless: options.headless !== false };
  return async function launchAutomationBrowser() {
    return await launchCamoufox(launchOptions);
  };
}

export function getAutomationBrowserUnavailableMessage() {
  return null;
}

export { AUTOMATION_BROWSER_CAMOFOX };
