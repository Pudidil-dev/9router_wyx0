const IP_PORT_RE = /^(\d{1,3}(?:\.\d{1,3}){3}):(\d{1,5})$/;
const SUPPORTED_PROTOCOLS = new Set(["http", "https"]);

function isValidIp(ip) {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(ip)
    && ip.split(".").every((part) => Number(part) >= 0 && Number(part) <= 255);
}

function isValidPort(port) {
  const value = Number(port);
  return Number.isInteger(value) && value > 0 && value <= 65535;
}

export function normalizeScrapedProxy(candidate = {}, options = {}) {
  const protocol = String(candidate.protocol || "http").toLowerCase();
  if (!SUPPORTED_PROTOCOLS.has(protocol)) {
    return { skipped: true, reason: "unsupported_protocol", protocol };
  }

  let host = candidate.host || candidate.ip || "";
  let port = candidate.port || "";

  if ((!host || !port) && candidate.proxy) {
    const match = String(candidate.proxy).trim().match(IP_PORT_RE);
    if (match) {
      host = match[1];
      port = match[2];
    }
  }

  host = String(host || "").trim();
  port = String(port || "").trim();

  if (!isValidIp(host) || !isValidPort(port)) {
    return { skipped: true, reason: "invalid_endpoint", protocol };
  }

  const proxyUrl = `http://${host}:${Number(port)}`;
  const sourceLabel = candidate.sourceLabel || options.sourceLabel || "Proxy Scraper";
  const scrapedAt = options.scrapedAt || new Date().toISOString();

  return {
    skipped: false,
    pool: {
      name: `Scraped ${sourceLabel} ${host}:${Number(port)}`,
      proxyUrl,
      noProxy: "",
      type: "http",
      isActive: options.activateImported !== false,
      strictProxy: false,
      testStatus: "unknown",
      sourceKind: "scraper",
      sourceId: candidate.sourceId || options.sourceId || "unknown",
      sourceLabel,
      sourceUrl: candidate.sourceUrl || options.sourceUrl || "",
      sourceProtocol: protocol,
      scrapedAt,
      lastSeenAt: scrapedAt,
      country: candidate.country || "",
      countryCode: candidate.countryCode || candidate.code || "",
      anonymity: candidate.anonymity || "",
      supportsHttps: candidate.supportsHttps === true || candidate.https === true,
      supportsGoogle: candidate.supportsGoogle === true || candidate.google === true,
    },
  };
}
