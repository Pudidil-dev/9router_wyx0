// Alibaba DashScope (Qwen-Image / Wan / Z-Image) — image generation adapter.
// Docs: https://www.alibabacloud.com/help/en/model-studio/text-to-image-v2-api-reference
//
// Two protocols (see registry entry for details):
//   NEW (wan2.6+, qwen-image-2.0+, z-image):
//     POST {submitUrl}  (async)  body: { model, input:{messages:[{role,content:[{text}]}]}, parameters:{size,n,...} }
//     Response (poll):  output.choices[].message.content[].image
//
//   LEGACY (wan2.5 and earlier, wanx*, qwen-image v1):
//     POST {submitUrl}  (async)  body: { model, input:{prompt, negative_prompt}, parameters:{size,n,...} }
//     Response (poll):  output.results[].url
//
// Protocol is read from the model entry's `protocol` field (default "new" if missing).

import { sleep, nowSec, POLL_INTERVAL_MS, POLL_TIMEOUT_MS } from "./_base.js";
import { PROVIDER_MEDIA, PROVIDER_MODELS } from "../../providers/index.js";

const CFG = PROVIDER_MEDIA["alibaba-image"]?.imageConfig || {};

// Lookup model entry to read its `protocol` field.
function getModelProtocol(modelId) {
  const models = PROVIDER_MODELS["alibaba-image"] || [];
  const entry = models.find((m) => m.id === modelId);
  return entry?.protocol || "new"; // default to new protocol
}

function getEndpoints(credentials, protocol) {
  const region = credentials?.region === "cn" ? "cn" : "intl";
  const block = CFG[region]?.[protocol];
  if (!block?.submitUrl || !block?.pollBase) {
    throw new Error(`Alibaba Image: ${protocol} endpoints not loaded for region "${region}"`);
  }
  return block;
}

// Convert OpenAI-style "1024x1024" to DashScope "1024*1024".
function toDashScopeSize(size) {
  if (!size || typeof size !== "string") return "1280*1280";
  if (size.includes("*")) return size;
  if (/^\d+x\d+$/.test(size)) return size.replace("x", "*");
  return "1280*1280";
}

export default {
  async: true,

  buildUrl: (model, creds) => {
    const protocol = getModelProtocol(model);
    return getEndpoints(creds, protocol).submitUrl;
  },

  buildHeaders: (creds) => {
    const key = creds?.apiKey || creds?.accessToken;
    if (!key) throw new Error("Alibaba Image: missing API key");
    return {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${key}`,
      "X-DashScope-Async": "enable",
    };
  },

  buildBody: (model, body) => {
    const protocol = getModelProtocol(model);
    const size = toDashScopeSize(body.size);
    const n = body.n || 1;

    if (protocol === "legacy") {
      // Legacy: flat prompt/negative_prompt
      const req = {
        model,
        input: { prompt: body.prompt },
        parameters: { size, n },
      };
      if (body.negative_prompt) req.input.negative_prompt = body.negative_prompt;
      return req;
    }

    // New protocol: messages format
    const req = {
      model,
      input: {
        messages: [
          {
            role: "user",
            content: [{ text: body.prompt }],
          },
        ],
      },
      parameters: { size, n },
    };
    if (body.negative_prompt) req.parameters.negative_prompt = body.negative_prompt;
    return req;
  },

  // Async: parse submit -> poll until SUCCEEDED -> return raw poll payload.
  async parseResponse(response, { headers }) {
    const submitData = await response.json();
    if (submitData.code) {
      throw new Error(`Alibaba Image submit failed: ${submitData.code} — ${submitData.message || ""}`);
    }
    const taskId = submitData.output?.task_id;
    if (!taskId) throw new Error("Alibaba Image: no task_id in submit response");

    // Resolve pollBase from submit URL host (dashscope-intl vs dashscope).
    const pollHeaders = { Authorization: headers.Authorization };
    const submitHost = new URL(response.url).host;
    const isIntl = submitHost.includes("dashscope-intl") || submitHost.includes("dashscope-us");
    const regionBlock = isIntl ? CFG.intl : CFG.cn;
    // Both protocols in the same region share the same pollBase.
    const pollBase = regionBlock?.new?.pollBase || regionBlock?.legacy?.pollBase;
    if (!pollBase) throw new Error("Alibaba Image: cannot resolve pollBase");

    const pollUrl = `${pollBase}/${taskId}`;
    const deadline = Date.now() + POLL_TIMEOUT_MS;

    while (Date.now() < deadline) {
      await sleep(POLL_INTERVAL_MS);
      const r = await fetch(pollUrl, { headers: pollHeaders });
      if (!r.ok) {
        const txt = await r.text().catch(() => "");
        throw new Error(`Alibaba Image poll HTTP ${r.status}: ${txt.slice(0, 200)}`);
      }
      const s = await r.json();
      const out = s.output || {};
      const status = out.task_status;
      if (status === "SUCCEEDED") return s;
      if (status === "FAILED" || status === "CANCELED" || status === "UNKNOWN") {
        throw new Error(`Alibaba Image task ${status}: ${out.message || JSON.stringify(out)}`);
      }
      // PENDING / RUNNING -> keep polling
    }
    throw new Error("Alibaba Image: polling timeout");
  },

  // Normalize → OpenAI-compatible shape { created, data: [{ url, revised_prompt }] }
  // Handles BOTH response shapes:
  //   new:    output.choices[].message.content[].image
  //   legacy: output.results[].url
  normalize: (responseBody, prompt) => {
    const out = responseBody.output || {};

    // New protocol: choices[].message.content[].image
    const choices = Array.isArray(out.choices) ? out.choices : [];
    if (choices.length > 0) {
      const urls = [];
      for (const choice of choices) {
        const content = choice?.message?.content || [];
        for (const item of content) {
          if (item?.image) urls.push(item.image);
        }
      }
      if (urls.length > 0) {
        return {
          created: nowSec(),
          data: urls.map((url) => ({ url, revised_prompt: prompt })),
        };
      }
    }

    // Legacy protocol: results[].url
    const results = Array.isArray(out.results) ? out.results : [];
    return {
      created: nowSec(),
      data: results
        .filter((item) => item?.url)
        .map((item) => ({ url: item.url, revised_prompt: item.orig_prompt || prompt })),
    };
  },
};
