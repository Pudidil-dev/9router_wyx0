import { PROVIDER_MEDIA } from "../../providers/index.js";
import {
  buildCodeBuddyCnAuthHeaders,
  CODEBUDDY_CN_DEFAULT_DOMAIN,
} from "../../services/codebuddyCn.js";

const BASE_URL = PROVIDER_MEDIA["codebuddy-cn"]?.imageConfig?.baseUrl;

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

function normalizeImageItem(item, prompt) {
  if (!item) return null;
  if (typeof item === "string") {
    if (/^https?:\/\//i.test(item)) return { url: item };
    return { b64_json: item, revised_prompt: prompt };
  }
  if (typeof item !== "object") return null;
  if (item.url) return { url: item.url, revised_prompt: item.revised_prompt || prompt };
  if (item.b64_json || item.b64) {
    return {
      b64_json: item.b64_json || item.b64,
      revised_prompt: item.revised_prompt || prompt,
    };
  }
  if (item.image_url) return { url: item.image_url, revised_prompt: item.revised_prompt || prompt };
  if (item.image_base64) {
    return {
      b64_json: item.image_base64,
      revised_prompt: item.revised_prompt || prompt,
    };
  }
  return null;
}

function collectImages(responseBody, prompt) {
  const candidates = [
    ...(Array.isArray(responseBody?.data) ? responseBody.data : []),
    ...(Array.isArray(responseBody?.images) ? responseBody.images : []),
    ...(Array.isArray(responseBody?.result?.images) ? responseBody.result.images : []),
    ...(Array.isArray(responseBody?.result) ? responseBody.result : []),
  ];
  return candidates
    .map((item) => normalizeImageItem(item, prompt))
    .filter(Boolean);
}

export default {
  buildUrl: (_model, credentials) => {
    const domain = credentials?.providerSpecificData?.domain || CODEBUDDY_CN_DEFAULT_DOMAIN;
    if (BASE_URL && domain === CODEBUDDY_CN_DEFAULT_DOMAIN) return BASE_URL;
    return `https://${domain}/chat/api/images`;
  },
  buildHeaders: (credentials) => ({
    "Content-Type": "application/json",
    ...buildCodeBuddyCnAuthHeaders(credentials),
  }),
  buildBody: (model, body) => {
    const request = {
      prompt: body.prompt,
      n: body.n || 1,
      size: body.size || "1024x1024",
    };
    if (model) request.model = model;
    if (body.response_format) request.response_format = body.response_format;
    if (body.quality) request.quality = body.quality;
    if (body.style) request.style = body.style;
    return request;
  },
  normalize: (responseBody, prompt) => {
    if (responseBody?.created && Array.isArray(responseBody?.data)) {
      return responseBody;
    }

    const data = collectImages(responseBody, prompt);
    return {
      created: nowSec(),
      data: data.length > 0 ? data : [{ b64_json: "", revised_prompt: prompt }],
    };
  },
};
