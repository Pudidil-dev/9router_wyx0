import { AUTOMATION_BROWSER_CAMOFOX, AUTOMATION_BROWSER_CHROMIUM, normalizeAutomationBrowser } from "@/shared/constants/automationBrowsers";

const CAMOFOX_UNAVAILABLE_MESSAGE = "Camofox browser support is not installed in this build. Switch to Playwright Chromium or install/configure Camofox support.";

async function launchChromium({ headless = true } = {}) {
  const { chromium } = await import("playwright");
  return await chromium.launch({
    headless,
  });
}

async function launchCamofox({ headless = true } = {}) {
  let mod;
  try {
    const optionalImport = new Function("specifier", "return import(specifier)");
    mod = await optionalImport("@askjo/camofox-browser");
  } catch {
    throw new Error(CAMOFOX_UNAVAILABLE_MESSAGE);
  }

  const launcher = mod.launch || mod.default?.launch || mod.default;
  if (typeof launcher !== "function") {
    throw new Error(CAMOFOX_UNAVAILABLE_MESSAGE);
  }

  return await launcher({ headless });
}

/**
 * @param {string} browser - normalized browser id (chromium|camofox)
 * @param {object} [options]
 * @param {boolean} [options.headless=true] - false to open a visible window for interactive login
 */
export function createAutomationBrowserLauncher(browser, options = {}) {
  const normalized = normalizeAutomationBrowser(browser);
  const launchOpts = { headless: options.headless !== false };
  return async function launchAutomationBrowser() {
    if (normalized === AUTOMATION_BROWSER_CAMOFOX) {
      return await launchCamofox(launchOpts);
    }
    return await launchChromium(launchOpts);
  };
}

export function getAutomationBrowserUnavailableMessage(browser) {
  return normalizeAutomationBrowser(browser) === AUTOMATION_BROWSER_CAMOFOX
    ? CAMOFOX_UNAVAILABLE_MESSAGE
    : null;
}

export { AUTOMATION_BROWSER_CAMOFOX, AUTOMATION_BROWSER_CHROMIUM, CAMOFOX_UNAVAILABLE_MESSAGE };
