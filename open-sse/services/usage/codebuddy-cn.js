/**
 * CodeBuddy CN usage handler
 *
 * Scoped to the "codebuddy-cn" provider specifically — a future "codebuddy-intl"
 * variant would get its own handler/endpoint, so keep this CN-only.
 *
 * Quota lives behind a Tencent billing endpoint (POST, payload wrapped twice
 * under data.Response.Data). It mixes two credit types that must NOT be merged:
 *
 *  - Refill / base ("基础体验包"): a recurring allowance whose cycle resets long
 *    before the resource itself expires (CycleEndTime << DeductionEndTime). The
 *    live numbers live in the *Cycle* fields (e.g. CycleCapacityUsed 6.54 / 500)
 *    and resetAt is the next monthly refresh.
 *  - Bonus ("活动赠送包"): one-shot credits that run a single cycle and then
 *    expire for good (CycleEndTime == DeductionEndTime). Numbers live in the
 *    plain Capacity fields.
 *
 * We surface one quota row per package — a cadence label (Monthly/Weekly/Daily)
 * for refill packs, "Bonus Pack N" for bonus packs (soonest-expiring first).
 *
 * Ported from upstream decolua/9router 8321032e. Wyx0 keeps its own
 * resolveCodeBuddyCnCredential / buildCodeBuddyCnProviderMetadata enrichment so
 * the providerSpecificDataPatch is still surfaced alongside the quota rows.
 */
import { proxyAwareFetch } from "../../utils/proxyFetch.js";
import { PROVIDERS } from "../../providers/index.js";
import { U, parseResetTime } from "./shared.js";
import {
  resolveCodeBuddyCnCredential,
  buildCodeBuddyCnAuthHeaders,
  buildCodeBuddyCnProviderMetadata,
} from "../codebuddyCn.js";

const PROVIDER_ID = "codebuddy-cn";
const PRODUCT_CODE = "p_tcaca";
const PAGE_SIZE = 100;

// Prefer the *Precise string fields (exact), fall back to the numeric ones.
function num(...values) {
  for (const value of values) {
    if (value === undefined || value === null || value === "") continue;
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function withBalance(total, used, remaining) {
  const safeTotal = Math.max(0, total ?? ((used ?? 0) + (remaining ?? 0)));
  const safeUsed = Math.max(0, used ?? Math.max(0, safeTotal - (remaining ?? 0)));
  const safeRemaining = Math.max(0, remaining ?? Math.max(0, safeTotal - safeUsed));

  return {
    used: safeUsed,
    total: safeTotal,
    remaining: safeRemaining,
    remainingPercentage: safeTotal > 0
      ? Math.max(0, Math.min(100, (safeRemaining / safeTotal) * 100))
      : 0,
  };
}

function timestampMs(value) {
  const parsed = parseResetTime(value);
  return parsed ? new Date(parsed).getTime() : Number.POSITIVE_INFINITY;
}

function formatUsageDate(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function buildCodeBuddyCnUsageBody() {
  const now = new Date();
  const rangeEnd = new Date(now);
  rangeEnd.setFullYear(rangeEnd.getFullYear() + 20);

  return {
    PageNumber: 1,
    PageSize: PAGE_SIZE,
    ProductCode: PRODUCT_CODE,
    Status: [0, 3],
    PackageEndTimeRangeBegin: formatUsageDate(now),
    PackageEndTimeRangeEnd: formatUsageDate(rangeEnd),
  };
}

// Label a refill pack by its cycle length (Monthly is the common CodeBuddy case).
function refillCadence(acc) {
  const start = parseResetTime(acc.CycleStartTime);
  const end = parseResetTime(acc.CycleEndTime);
  if (start && end) {
    const days = (new Date(end).getTime() - new Date(start).getTime()) / 86400000;
    if (days <= 1.5) return "Daily";
    if (days <= 10) return "Weekly";
  }
  return "Monthly";
}

export async function getCodeBuddyCnUsage(accessToken, apiKey, providerSpecificData, proxyOptions = null) {
  // Wyx0 enrichment: resolve the credential the same way the chat path does so
  // the providerMetadata patch stays consistent with what was used to chat.
  const connectionLike = { accessToken, apiKey, providerSpecificData };
  const resolved = resolveCodeBuddyCnCredential(connectionLike);
  const token = resolved.token || accessToken || apiKey;
  const providerMetadata = buildCodeBuddyCnProviderMetadata(connectionLike);

  if (!token) {
    return {
      plan: "CodeBuddy CN",
      message: "CodeBuddy CN credential not available.",
      quotas: {},
      providerSpecificDataPatch: providerMetadata,
    };
  }

  try {
    const response = await proxyAwareFetch(U(PROVIDER_ID).url, {
      method: "POST",
      headers: buildCodeBuddyCnAuthHeaders(connectionLike, {
        ...(PROVIDERS[PROVIDER_ID]?.headers || {}),
        "Content-Type": "application/json",
        Accept: "application/json",
      }),
      body: JSON.stringify(buildCodeBuddyCnUsageBody()),
    }, proxyOptions);

    if (response.status === 401 || response.status === 403) {
      return {
        plan: "CodeBuddy CN",
        message: "CodeBuddy CN credential invalid or expired.",
        quotas: {},
        providerSpecificDataPatch: providerMetadata,
      };
    }
    if (!response.ok) {
      return {
        plan: "CodeBuddy CN",
        message: `CodeBuddy CN quota API error (${response.status}).`,
        quotas: {},
        providerSpecificDataPatch: providerMetadata,
      };
    }

    const json = await response.json();
    if (json?.code !== 0) {
      return {
        plan: "CodeBuddy CN",
        message: `CodeBuddy CN quota error: ${json?.msg || "unknown"}`,
        quotas: {},
        providerSpecificDataPatch: providerMetadata,
      };
    }

    const data = json?.data?.Response?.Data || {};
    const accounts = Array.isArray(data.Accounts) ? data.Accounts : [];
    if (accounts.length === 0) {
      return {
        plan: "CodeBuddy CN",
        message: "CodeBuddy CN connected. No credit package found.",
        quotas: {},
        providerSpecificDataPatch: providerMetadata,
      };
    }

    // Refill packs roll into a new cycle before the resource expires; bonus packs
    // end exactly at expiry. >2d gap between cycle end and validity end = refill.
    const REFILL_GAP_MS = 2 * 24 * 60 * 60 * 1000;
    const isRefill = (acc) => {
      const ce = timestampMs(acc.CycleEndTime);
      const de = timestampMs(acc.DeductionEndTime || acc.ExpiredTime);
      return Number.isFinite(ce) && Number.isFinite(de) && de - ce > REFILL_GAP_MS;
    };
    const byExpiry = (a, b) => (
      timestampMs(a.CycleEndTime || a.DeductionEndTime || a.ExpiredTime)
      - timestampMs(b.CycleEndTime || b.DeductionEndTime || b.ExpiredTime)
    );

    const refills = accounts.filter(isRefill).sort(byExpiry);
    const bonuses = accounts.filter((a) => !isRefill(a)).sort(byExpiry);

    const quotas = {};
    // Refill packs first: cadence-labelled, using the *Cycle* balance and
    // resetting at the next refresh.
    const seenRefill = {};
    refills.forEach((acc) => {
      const base = refillCadence(acc);
      seenRefill[base] = (seenRefill[base] || 0) + 1;
      const name = seenRefill[base] > 1 ? `${base} ${seenRefill[base]}` : base;
      quotas[name] = {
        ...withBalance(
          num(acc.CycleCapacitySizePrecise, acc.CycleCapacitySize),
          num(acc.CycleCapacityUsedPrecise, acc.CycleCapacityUsed),
          num(acc.CycleCapacityRemainPrecise, acc.CycleCapacityRemain),
        ),
        resetAt: parseResetTime(acc.CycleEndTime),
        unit: "credits",
        unlimited: false,
      };
    });
    // Bonus packs: use the lifetime Capacity balance; resetAt is the expiry.
    bonuses.forEach((acc, i) => {
      quotas[`Bonus Pack ${i + 1}`] = {
        ...withBalance(
          num(acc.CapacitySizePrecise, acc.CapacitySize),
          num(acc.CapacityUsedPrecise, acc.CapacityUsed),
          num(acc.CapacityRemainPrecise, acc.CapacityRemain),
        ),
        resetAt: parseResetTime(acc.DeductionEndTime || acc.ExpiredTime || acc.CycleEndTime),
        unit: "credits",
        unlimited: false,
      };
    });

    const basePkg = refills[0] || accounts[0] || {};
    const plan = basePkg.PackageName || basePkg.SubProductName || "CodeBuddy CN";

    return { plan, quotas, providerSpecificDataPatch: providerMetadata };
  } catch (error) {
    return {
      plan: "CodeBuddy CN",
      message: `CodeBuddy CN error: ${error.message}`,
      quotas: {},
      providerSpecificDataPatch: providerMetadata,
    };
  }
}
