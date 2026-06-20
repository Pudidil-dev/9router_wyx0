export const AUTOMATION_BROWSER_CAMOFOX = "camofox";

export const DEFAULT_AUTOMATION_BROWSER = AUTOMATION_BROWSER_CAMOFOX;

export const AUTOMATION_BROWSER_OPTIONS = [
  {
    id: AUTOMATION_BROWSER_CAMOFOX,
    label: "Camoufox",
    badge: "Default",
    description: "Runs isolated Camoufox workers without opening your installed Chrome browser.",
  },
];

export function normalizeAutomationBrowser() {
  return AUTOMATION_BROWSER_CAMOFOX;
}

export function getAutomationBrowserOption() {
  return AUTOMATION_BROWSER_OPTIONS[0];
}
