export default {
  id: "alicode-intl",
  priority: 10,
  alias: "alicode-intl",
  display: {
    name: "Alibaba Intl",
    icon: "cloud",
    color: "#FF6A00",
    textIcon: "ALi",
    website: "https://modelstudio.console.alibabacloud.com",
    notice: {
      apiKeyUrl: "https://modelstudio.console.alibabacloud.com/?apiKey=1",
    },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://coding-intl.dashscope.aliyuncs.com/v1/chat/completions",
    // DashScope's OpenAI-compatible gateway routes reasoning models (GLM-5.x,
    // Kimi, MiniMax, DeepSeek) through a unified OpenAI-style reasoning_effort
    // parameter — same as CodeBuddy CN. Without this flag the router treats the
    // provider as a plain OpenAI endpoint, GLM-5.2 returns thinking-only output,
    // and the response body's `content` field ends up empty.
    thinkingFormat: "openai",
    // DashScope returns empty `content` for reasoning models when stream:false.
    // Force streaming so the router receives SSE deltas (with both
    // reasoning_content + content) and reconstructs a full JSON response via
    // parseSSEToOpenAIResponse. Same pattern as codebuddy-cn.
    forceStream: true,
    headers: {},
  },
  models: [
    { id: "glm-5.2",          name: "GLM 5.2" },
    { id: "glm-5.1",          name: "GLM 5.1" },
    { id: "glm-5",            name: "GLM 5" },
    { id: "glm-4.7",          name: "GLM 4.7" },
    { id: "kimi-k2.5",        name: "Kimi K2.5" },
    { id: "MiniMax-M2.5",     name: "MiniMax M2.5" },
    { id: "qwen3-coder-next", name: "Qwen3 Coder Next" },
    { id: "qwen3-coder-plus", name: "Qwen3 Coder Plus" },
    { id: "qwen3.5-plus",     name: "Qwen3.5 Plus" },
  ],
};
