import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";

const ONE_MIN_CHAT_TYPE = "UNIFY_CHAT_WITH_AI";
const ONE_MIN_APP_URL = "https://app.1min.ai/chat-with-ai";

function getTextFromContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (part?.type === "text") return part.text || "";
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function buildPrompt(messages = []) {
  return messages
    .map((message) => {
      const role = message?.role || "user";
      const text = getTextFromContent(message?.content).trim();
      if (!text) return "";
      if (role === "user") return text;
      return `${role.toUpperCase()}: ${text}`;
    })
    .filter(Boolean)
    .join("\n\n");
}

function buildOneMinBody(model, body) {
  return {
    type: ONE_MIN_CHAT_TYPE,
    model,
    promptObject: {
      prompt: buildPrompt(body?.messages) || String(body?.prompt || ""),
    },
  };
}

function createOpenAIChunk(model, content, finishReason = null) {
  return {
    id: `chatcmpl-1min-${Date.now().toString(36)}`,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{
      index: 0,
      delta: finishReason ? {} : { content },
      finish_reason: finishReason,
    }],
  };
}

function extractOneMinResultText(payload) {
  const resultObject = payload?.aiRecord?.aiRecordDetail?.resultObject
    || payload?.data?.aiRecord?.aiRecordDetail?.resultObject;
  if (Array.isArray(resultObject)) return resultObject.join("");
  if (typeof resultObject === "string") return resultObject;
  if (typeof payload?.content === "string") return payload.content;
  return "";
}

function formatOpenAISSE(payload) {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

export function wrapOneMinSSE(response, model) {
  if (!response.body) return response;

  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const reader = response.body.getReader();
  let buffer = "";
  let doneSent = false;

  const emit = (controller, payload) => {
    controller.enqueue(encoder.encode(formatOpenAISSE(payload)));
  };

  const emitDone = (controller) => {
    if (doneSent) return;
    doneSent = true;
    emit(controller, createOpenAIChunk(model, "", "stop"));
    controller.enqueue(encoder.encode("data: [DONE]\n\n"));
  };

  const processFrame = (frame, controller) => {
    const lines = frame.split(/\r?\n/);
    let event = "message";
    const dataLines = [];
    for (const line of lines) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
    }
    const data = dataLines.join("\n").trim();
    if (!data) return;
    if (event === "done") {
      emitDone(controller);
      return;
    }

    let payload = null;
    try {
      payload = JSON.parse(data);
    } catch {
      payload = null;
    }

    const content = event === "content"
      ? (payload?.content || data)
      : extractOneMinResultText(payload);
    if (content) emit(controller, createOpenAIChunk(model, content));
    if (event === "result") emitDone(controller);
  };

  const stream = new ReadableStream({
    async pull(controller) {
      while (true) {
        const separatorIndex = buffer.search(/\r?\n\r?\n/);
        if (separatorIndex >= 0) {
          const frame = buffer.slice(0, separatorIndex);
          const match = buffer.slice(separatorIndex).match(/^\r?\n\r?\n/);
          buffer = buffer.slice(separatorIndex + (match?.[0]?.length || 2));
          processFrame(frame, controller);
          return;
        }

        const { value, done } = await reader.read();
        if (done) {
          if (buffer.trim()) processFrame(buffer, controller);
          emitDone(controller);
          controller.close();
          return;
        }
        buffer += decoder.decode(value, { stream: true });
      }
    },
    async cancel(reason) {
      await reader.cancel(reason).catch(() => null);
    },
  });

  return new Response(stream, {
    status: response.status,
    statusText: response.statusText,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "X-Accel-Buffering": "no",
    },
  });
}

function buildOpenAICompletion(model, content) {
  return {
    id: `chatcmpl-1min-${Date.now().toString(36)}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{
      index: 0,
      message: { role: "assistant", content },
      finish_reason: "stop",
    }],
  };
}

export class OneMinAIExecutor extends BaseExecutor {
  constructor() {
    super("1min-ai", PROVIDERS["1min-ai"]);
  }

  buildHeaders(credentials, stream = true) {
    const apiKey = credentials?.apiKey || "";
    const sessionToken = credentials?.accessToken || "";
    const headers = {
      "Content-Type": "application/json",
      "Origin": "https://app.1min.ai",
      "Referer": ONE_MIN_APP_URL,
    };
    if (sessionToken) {
      headers["X-Auth-Token"] = sessionToken.startsWith("Bearer ") ? sessionToken : `Bearer ${sessionToken}`;
    }
    if (apiKey) {
      headers["API-KEY"] = apiKey.startsWith("Bearer ") ? apiKey.slice(7) : apiKey;
    }
    if (stream) headers.Accept = "text/event-stream";
    return headers;
  }

  buildUrl(_model, stream) {
    return `${this.config.baseUrl}/chat-with-ai${stream ? "?isStreaming=true" : ""}`;
  }

  transformRequest(model, body) {
    return buildOneMinBody(model, body);
  }

  async execute({ model, body, stream, credentials, signal, proxyOptions = null }) {
    const url = this.buildUrl(model, stream, credentials);
    const transformedBody = this.transformRequest(model, body);
    const headers = this.buildHeaders(credentials, stream);
    const response = await proxyAwareFetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(transformedBody),
      signal,
    }, proxyOptions);

    if (!response.ok) {
      return { response, url, headers, transformedBody };
    }

    if (stream) {
      return {
        response: wrapOneMinSSE(response, model),
        url,
        headers,
        transformedBody,
      };
    }

    const payload = await response.json();
    const content = extractOneMinResultText(payload);
    return {
      response: new Response(JSON.stringify(buildOpenAICompletion(model, content)), {
        status: response.status,
        statusText: response.statusText,
        headers: { "Content-Type": "application/json" },
      }),
      url,
      headers,
      transformedBody,
    };
  }
}

export const __testables = {
  buildOneMinBody,
  buildPrompt,
  extractOneMinResultText,
};
