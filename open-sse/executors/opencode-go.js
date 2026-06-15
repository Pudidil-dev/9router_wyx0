import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { injectReasoningContent } from "../utils/reasoningContentInjector.js";

const DEFAULT_BASE = "https://opencode.ai/zen/go/v1/messages";

export class OpenCodeGoExecutor extends BaseExecutor {
  constructor() {
    super("opencode-go", PROVIDERS["opencode-go"]);
  }

  buildUrl(model, stream, urlIndex = 0, credentials = null) {
    return credentials?.providerSpecificData?.baseUrl || DEFAULT_BASE;
  }

  buildHeaders(credentials, stream = true) {
    const key = credentials?.apiKey || credentials?.accessToken;
    const headers = {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${key}`,
      "anthropic-version": "2023-06-01",
    };
    if (stream) headers["Accept"] = "text/event-stream";
    return headers;
  }

  transformRequest(model, body) {
    return injectReasoningContent({ provider: this.provider, model, body });
  }
}
