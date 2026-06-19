export const AUTOMATION_BROWSER_CHROMIUM = "playwright-chromium";
export const AUTOMATION_BROWSER_GOOGLE_CHROME = "google-chrome";
export const AUTOMATION_BROWSER_CAMOFOX = "camofox";

export const DEFAULT_AUTOMATION_BROWSER = AUTOMATION_BROWSER_GOOGLE_CHROME;

export const AUTOMATION_BROWSER_OPTIONS = [
  {
    id: AUTOMATION_BROWSER_CHROMIUM,
    label: "Playwright Chromium",
    badge: "Bundled",
    description: "Uses the bundled Playwright Chromium automation.",
  },
  {
    id: AUTOMATION_BROWSER_GOOGLE_CHROME,
    label: "Google Chrome",
    badge: "Recommended",
    description: "Uses your installed Google Chrome browser for Google login compatibility.",
  },
  {
    id: AUTOMATION_BROWSER_CAMOFOX,
    label: "Camofox",
    badge: "Experimental",
    description: "Requires Camofox support to be installed/configured. Use only for accounts you own or are authorized to automate.",
    warning: "Camofox is experimental and optional. If support is not installed in this build, the job will stop with an error instead of falling back silently.",
  },
];

export function normalizeAutomationBrowser(value) {
  return AUTOMATION_BROWSER_OPTIONS.some((option) => option.id === value)
    ? value
    : DEFAULT_AUTOMATION_BROWSER;
}

export function getAutomationBrowserOption(value) {
  const browser = normalizeAutomationBrowser(value);
  return AUTOMATION_BROWSER_OPTIONS.find((option) => option.id === browser) || AUTOMATION_BROWSER_OPTIONS[0];
}
