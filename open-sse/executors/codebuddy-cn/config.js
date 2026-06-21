// CodeBuddy CN Configuration Constants
// Reconstructed from enowxai reverse engineering

// Base URLs
export const CN_BASE_URL = "https://www.codebuddy.cn";
export const CN_COPILOT_URL = "https://copilot.tencent.com";

// API Endpoints (CN domain)
export const AUTH_STATE_URL = "https://www.codebuddy.cn/v2/plugin/auth/state";
export const CN_API_KEYS_URL = "https://www.codebuddy.cn/console/api/client/v1/api-keys";
export const CN_BILLING_URL = "https://copilot.tencent.com/v2/billing/meter/get-user-resource";
export const CN_USER_INFO_URL = "https://www.codebuddy.cn/api/v1/userinfo";
export const CN_GATEWAY_STATUS_URL = "https://www.codebuddy.cn/api/gateway/status";
export const CN_PROFILE_URL = "https://www.codebuddy.cn/profile";
export const CN_CONSOLE_ACCOUNTS_URL = "https://www.codebuddy.cn/console/accounts";

// Activation and Invite (unique to CN)
export const CN_ACTIVATION_URL = "https://www.codebuddy.cn/activity/growth/buddy/first/v1/user/buy/activation";
export const CN_INVITE_BASE_URL = "https://www.codebuddy.cn/events/invite";
export const CN_DEFAULT_INVITE_CODE = "yro4ic1m1pc";

// Hong Kong Virtual Phone (for SMS verification in China)
export const HK_VIRTUAL_PATH = "hongkong/virtual54/codebuddy";
export const HK_VIRTUAL_PROVIDER = "5sim";
export const HK_COUNTRY_CODE = "+852";

// Proxy Routing (Go binary identifier)
export const PROXY_FLAG = "for_codebuddy_cn";

// CLI Version Strings
export const DEFAULT_CLI_VERSION = "CLI/2.106.3 CodeBuddy/2.106.3";

// User-Agent
export const CN_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/131.0.0.0 Safari/537.36";

// Locale Override (from binary: Emulation.setLocaleOverride)
export const CN_LOCALE = "zh-CN";
export const CN_LOCALE_OVERRIDE = { locale: "zh-CN", timezoneId: "Asia/Shanghai" };

// Region
export const CN_DEFAULT_REGION = "china-mainland";
export const CN_FALLBACK_REGION = "singapore";

// Timeouts (seconds) - auth longer for China due to GFW
export const CN_BOOTSTRAP_TIMEOUT = 90;
export const CN_AUTH_TIMEOUT = 180;
export const CN_TOKEN_TIMEOUT = 30;
export const CN_QUOTA_TIMEOUT = 20;
export const CN_ACTIVATION_TIMEOUT = 120;
export const CN_HK_PHONE_TIMEOUT = 60;

// Gateway Auth (from binary: ApplyCodeBuddyGatewayAuthFailure)
export const GATEWAY_AUTH_HEADER = "X-CodeBuddy-Gateway-Auth";
export const GATEWAY_PROBATION_MSG = "warmup: codebuddy gateway auth blocker, entering probation";

export const CN_CONFIG = {
  baseUrl: CN_BASE_URL,
  copilotUrl: CN_COPILOT_URL,
  authStateUrl: AUTH_STATE_URL,
  apiKeysUrl: CN_API_KEYS_URL,
  billingUrl: CN_BILLING_URL,
  userInfoUrl: CN_USER_INFO_URL,
  gatewayStatusUrl: CN_GATEWAY_STATUS_URL,
  activationUrl: CN_ACTIVATION_URL,
  inviteBaseUrl: CN_INVITE_BASE_URL,
  defaultInviteCode: CN_DEFAULT_INVITE_CODE,
  hkVirtualPath: HK_VIRTUAL_PATH,
  proxyFlag: PROXY_FLAG,
  cliVersion: DEFAULT_CLI_VERSION,
  locale: CN_LOCALE,
  localeOverride: CN_LOCALE_OVERRIDE,
  defaultRegion: CN_DEFAULT_REGION,
  timeouts: {
    bootstrap: CN_BOOTSTRAP_TIMEOUT,
    auth: CN_AUTH_TIMEOUT,
    token: CN_TOKEN_TIMEOUT,
    quota: CN_QUOTA_TIMEOUT,
    activation: CN_ACTIVATION_TIMEOUT,
    hkPhone: CN_HK_PHONE_TIMEOUT,
  },
};
