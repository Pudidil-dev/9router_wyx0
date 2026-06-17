export default {
  id: "1min-ai",
  priority: 40,
  alias: "1min",
  uiAlias: "1min",
  display: {
    name: "1min AI",
    icon: "bolt",
    color: "#0EA5E9",
    website: "https://app.1min.ai",
    notice: {
      signupUrl: "https://app.1min.ai",
    },
    deprecated: true,
    deprecationNotice: "RISK_NOTICE",
  },
  category: "free",
  transport: {
    baseUrl: "https://api.1min.ai/api",
    format: "openai",
    headers: {},
    timeoutMs: 90000,
    stallTimeoutMs: 90000,
  },
  models: [
    { id: "gpt-4o-mini", name: "GPT-4o Mini" },
    { id: "gpt-4o", name: "GPT-4o" },
    { id: "gpt-4-turbo", name: "GPT-4 Turbo" },
    { id: "gpt-4", name: "GPT-4" },
    { id: "gpt-3.5-turbo", name: "GPT-3.5 Turbo" },
    { id: "o1-mini", name: "O1 Mini" },
    { id: "o1-preview", name: "O1 Preview" },
  ],
};
