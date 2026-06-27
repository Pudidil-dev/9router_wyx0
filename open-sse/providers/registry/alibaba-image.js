// Alibaba DashScope — Image Generation (Qwen-Image / Wan / Z-Image series)
// Docs: https://www.alibabacloud.com/help/en/model-studio/text-to-image-v2-api-reference
//
// IMPORTANT: DashScope has TWO image-gen protocols:
//
//   1. NEW protocol (wan2.6+, qwen-image-2.0+, z-image):
//      - async: POST /services/aigc/image-generation/generation
//      - sync:  POST /services/aigc/multimodal-generation/generation
//      - Body: { model, input: { messages: [{ role:"user", content:[{text:prompt}] }] }, parameters:{size,n,...} }
//      - Response (poll): output.choices[].message.content[].image
//
//   2. LEGACY protocol (wan2.5 and earlier, wanx*, qwen-image v1):
//      - POST /services/aigc/text2image/image-synthesis
//      - Body: { model, input: { prompt, negative_prompt }, parameters:{size,n,...} }
//      - Response (poll): output.results[].url
//
// Each model below is tagged with `protocol: "new"` or `protocol: "legacy"`.
// The adapter reads this to pick endpoint + body format.

export default {
  id: "alibaba-image",
  priority: 60,
  alias: "alibaba-image",
  aliases: ["albb-image", "dashscope-image", "qwen-image", "wan"],
  uiAlias: "albb-image",
  display: {
    name: "Alibaba Image",
    icon: "image",
    color: "#FF6A00",
    textIcon: "ALi",
    website: "https://modelstudio.console.alibabacloud.com",
    notice: {
      apiKeyUrl: "https://modelstudio.console.alibabacloud.com/?apiKey=1",
      text: "Alibaba Cloud Model Studio (DashScope) — Qwen-Image / Wan / Z-Image series. Generate anime, illustration, and photoreal images.",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: null,

  models: [
    // ── Wan series (NEW protocol) ──
    { id: "wan2.7-image-pro",            name: "Wan 2.7 Image Pro",            params: ["n", "size"], kind: "image", protocol: "new" },
    { id: "wan2.7-image",                name: "Wan 2.7 Image",                params: ["n", "size"], kind: "image", protocol: "new" },

    // ── Qwen-Image 2.0 series (NEW protocol) ──
    { id: "qwen-image-2.0-pro-2026-06-22", name: "Qwen Image 2.0 Pro (2026-06-22)", params: ["n", "size"], kind: "image", protocol: "new" },
    { id: "qwen-image-2.0-pro-2026-04-22", name: "Qwen Image 2.0 Pro (2026-04-22)", params: ["n", "size"], kind: "image", protocol: "new" },
    { id: "qwen-image-2.0-pro-2026-03-03", name: "Qwen Image 2.0 Pro (2026-03-03)", params: ["n", "size"], kind: "image", protocol: "new" },
    { id: "qwen-image-2.0-pro",             name: "Qwen Image 2.0 Pro",              params: ["n", "size"], kind: "image", protocol: "new" },
    { id: "qwen-image-2.0-2026-03-03",      name: "Qwen Image 2.0 (2026-03-03)",     params: ["n", "size"], kind: "image", protocol: "new" },
    { id: "qwen-image-2.0",                 name: "Qwen Image 2.0",                  params: ["n", "size"], kind: "image", protocol: "new" },

    // ── Qwen-Image Plus / Max (NEW protocol) ──
    { id: "qwen-image-plus-2026-01-09",  name: "Qwen Image Plus (2026-01-09)",  params: ["n", "size"], kind: "image", protocol: "new" },
    { id: "qwen-image-plus",             name: "Qwen Image Plus",               params: ["n", "size"], kind: "image", protocol: "new" },
    { id: "qwen-image-max-2025-12-30",   name: "Qwen Image Max (2025-12-30)",   params: ["n", "size"], kind: "image", protocol: "new" },
    { id: "qwen-image-max",              name: "Qwen Image Max",                params: ["n", "size"], kind: "image", protocol: "new" },

    // ── Z-Image (NEW protocol) ──
    { id: "z-image-turbo",               name: "Z Image Turbo",                 params: ["n", "size"], kind: "image", protocol: "new" },

    // ── Qwen-Image Edit series (NEW protocol) ──
    { id: "qwen-image-edit-max-2026-01-16",  name: "Qwen Image Edit Max (2026-01-16)",  params: ["size"], capabilities: ["edit"], kind: "image", protocol: "new" },
    { id: "qwen-image-edit-max",             name: "Qwen Image Edit Max",               params: ["size"], capabilities: ["edit"], kind: "image", protocol: "new" },
    { id: "qwen-image-edit-plus-2025-12-15", name: "Qwen Image Edit Plus (2025-12-15)", params: ["size"], capabilities: ["edit"], kind: "image", protocol: "new" },
    { id: "qwen-image-edit-plus-2025-10-30", name: "Qwen Image Edit Plus (2025-10-30)", params: ["size"], capabilities: ["edit"], kind: "image", protocol: "new" },
    { id: "qwen-image-edit-plus",            name: "Qwen Image Edit Plus",              params: ["size"], capabilities: ["edit"], kind: "image", protocol: "new" },
    { id: "qwen-image-edit",                 name: "Qwen Image Edit",                   params: ["size"], capabilities: ["edit"], kind: "image", protocol: "new" },

    // ── Legacy models (wan2.5 and earlier) — LEGACY protocol ──
    // Uncomment if you have access to these older models:
    // { id: "wan2.5-t2i-preview",  name: "Wan 2.5 T2I Preview",  params: ["n", "size"], kind: "image", protocol: "legacy" },
    // { id: "wanx2.1-t2i-plus",    name: "Wanx 2.1 T2I Plus",    params: ["n", "size"], kind: "image", protocol: "legacy" },
    // { id: "wanx2.1-t2i-turbo",   name: "Wanx 2.1 T2I Turbo",   params: ["n", "size"], kind: "image", protocol: "legacy" },
  ],

  serviceKinds: ["image"],

  imageConfig: {
    // Regional endpoints. Two protocols per region:
    //   new:    image-generation/generation + multimodal-generation/generation
    //   legacy: text2image/image-synthesis
    intl: {
      new: {
        submitUrl: "https://dashscope-intl.aliyuncs.com/api/v1/services/aigc/image-generation/generation",
        syncUrl:   "https://dashscope-intl.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation",
        pollBase:  "https://dashscope-intl.aliyuncs.com/api/v1/tasks",
      },
      legacy: {
        submitUrl: "https://dashscope-intl.aliyuncs.com/api/v1/services/aigc/text2image/image-synthesis",
        pollBase:  "https://dashscope-intl.aliyuncs.com/api/v1/tasks",
      },
    },
    cn: {
      new: {
        submitUrl: "https://dashscope.aliyuncs.com/api/v1/services/aigc/image-generation/generation",
        syncUrl:   "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation",
        pollBase:  "https://dashscope.aliyuncs.com/api/v1/tasks",
      },
      legacy: {
        submitUrl: "https://dashscope.aliyuncs.com/api/v1/services/aigc/text2image/image-synthesis",
        pollBase:  "https://dashscope.aliyuncs.com/api/v1/tasks",
      },
    },
  },

  // Auto-detect models via DashScope OpenAI-compatible /models endpoint.
  modelsFetcher: {
    url: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/models",
    type: "alibaba-image",
  },
};
