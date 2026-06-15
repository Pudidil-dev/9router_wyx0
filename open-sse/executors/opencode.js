import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { injectReasoningContent } from "../utils/reasoningContentInjector.js";

const DEFAULT_BASE = "https://opencode.ai/zen/v1/chat/completions";

export class OpenCodeExecutor extends BaseExecutor {
  constructor() {
    super("opencode", PROVIDERS.opencode);
  }

  transformRequest(model, body) {
    return injectReasoningContent({ provider: this.provider, model, body });
  }

  buildUrl(model, stream, urlIndex = 0, credentials = null) {
    return credentials?.providerSpecificData?.baseUrl || DEFAULT_BASE;
  }

  buildHeaders(credentials, stream = true) {
    const key = credentials?.apiKey || credentials?.accessToken;
    const headers = {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${key}`,
      "x-opencode-client": "desktop",
    };
    if (stream) headers["Accept"] = "text/event-stream";
    return headers;
  }
}
