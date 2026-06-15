import { mergeProxyPool, updateSettings } from "@/lib/localDb";
import { normalizeScrapedProxy } from "./normalize.js";
import { scrapeProxySources } from "./sources.js";

const DEFAULT_SOURCE_IDS = ["github", "free-proxy-list"];
const DEFAULT_PROTOCOLS = ["http", "https", "socks4", "socks5"];
const MAX_LIMIT = 1000;

function normalizeSourceIds(sourceIds) {
  if (!Array.isArray(sourceIds) || sourceIds.length === 0) return DEFAULT_SOURCE_IDS;
  if (sourceIds.includes("all")) return DEFAULT_SOURCE_IDS;
  return sourceIds.filter((id) => DEFAULT_SOURCE_IDS.includes(id));
}

function toPositiveLimit(value) {
  const limit = Number(value);
  if (!Number.isFinite(limit) || limit <= 0) return 100;
  return Math.min(Math.floor(limit), MAX_LIMIT);
}

export async function runProxyScrape(options = {}) {
  const sourceIds = normalizeSourceIds(options.sourceIds);
  const limit = toPositiveLimit(options.limit);
  const activateImported = options.activateImported !== false;
  const scrapedAt = new Date().toISOString();

  const summary = {
    fetched: 0,
    normalized: 0,
    created: 0,
    merged: 0,
    skippedUnsupported: 0,
    skippedInvalid: 0,
    failed: 0,
  };

  if (sourceIds.length === 0) {
    return { ok: false, summary, errors: [{ error: "No valid sources selected" }] };
  }

  const { candidates, errors } = await scrapeProxySources({
    sourceIds,
    protocols: DEFAULT_PROTOCOLS,
    target: options.target || "us",
  });

  summary.fetched = candidates.length;
  summary.failed = errors.length;

  const seen = new Set();
  const importedPools = [];

  for (const candidate of candidates) {
    if (importedPools.length >= limit) break;

    const normalized = normalizeScrapedProxy(candidate, { activateImported, scrapedAt });
    if (normalized.skipped) {
      if (normalized.reason === "unsupported_protocol") summary.skippedUnsupported += 1;
      else summary.skippedInvalid += 1;
      continue;
    }

    const key = `${normalized.pool.type}:${normalized.pool.proxyUrl}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    summary.normalized += 1;

    try {
      const { pool, action } = await mergeProxyPool(normalized.pool);
      if (action === "merged") summary.merged += 1;
      else summary.created += 1;
      if (pool) importedPools.push(pool);
    } catch (error) {
      summary.failed += 1;
      errors.push({ sourceId: candidate.sourceId, proxy: candidate.proxy || candidate.ip, error: error.message });
    }
  }

  const result = {
    ok: true,
    summary,
    importedPools,
    errors,
    ranAt: scrapedAt,
  };

  if (options.persistLastRun === true) {
    await updateSettings({
      proxyScraperLastRunAt: scrapedAt,
      proxyScraperLastSummary: summary,
    });
  }

  return result;
}
