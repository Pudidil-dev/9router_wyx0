import { NextResponse } from "next/server";
import { createProviderConnection } from "@/models";
import { assertProviderEnabled } from "@/lib/providerDisabled";

export const dynamic = "force-dynamic";

const CODEBUDDY_PROVIDER_ID = "codebuddy";
const CODEBUDDY_DOMAIN = "www.codebuddy.ai";

async function fetchAccountInfo(accessToken, domain) {
  try {
    const response = await fetch(`https://${domain}/v2/plugin/accounts`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        "X-Domain": domain,
      },
    });

    if (!response.ok) return { uid: null, email: null, nickname: null };

    const body = await response.json();
    const accounts = body?.data?.accounts || [];
    const account = accounts.find((a) => a.lastLogin) || accounts[0] || {};
    return {
      uid: account.uid || null,
      email: account.email || account.nickname || null,
      nickname: account.nickname || null,
      enterpriseId: account.enterpriseId || null,
    };
  } catch {
    return { uid: null, email: null, nickname: null };
  }
}

export async function POST(request) {
  try {
    await assertProviderEnabled(CODEBUDDY_PROVIDER_ID);
    const body = await request.json();
    const rawTokens = body?.tokens;

    if (!rawTokens || (typeof rawTokens !== "string" && !Array.isArray(rawTokens))) {
      return NextResponse.json(
        { error: "Provide tokens as a string (one per line) or array" },
        { status: 400 }
      );
    }

    const tokenList = Array.isArray(rawTokens)
      ? rawTokens.map((t) => String(t || "").trim()).filter(Boolean)
      : String(rawTokens)
          .split(/[\r\n]+/)
          .map((t) => t.trim())
          .filter(Boolean);

    if (tokenList.length === 0) {
      return NextResponse.json(
        { error: "At least one token is required" },
        { status: 400 }
      );
    }

    const results = [];

    for (const token of tokenList) {
      try {
        const info = await fetchAccountInfo(token, CODEBUDDY_DOMAIN);
        const email = info.email || `token-${token.substring(0, 8)}...`;

        const providerSpecificData = {
          domain: CODEBUDDY_DOMAIN,
          loginEmail: email,
          automation: "bulk-token-import",
        };

        if (info.uid) providerSpecificData.uid = info.uid;
        if (info.enterpriseId) providerSpecificData.enterpriseId = info.enterpriseId;

        const connection = await createProviderConnection({
          provider: CODEBUDDY_PROVIDER_ID,
          authType: "oauth",
          accessToken: token,
          email,
          providerSpecificData,
          isActive: false,
          testStatus: info.uid ? "active" : "unknown",
        });

        results.push({
          email,
          status: "success",
          connectionId: connection.id,
          uid: info.uid,
        });
      } catch (error) {
        results.push({
          token: token.substring(0, 12) + "...",
          status: "failed",
          error: error.message || "Failed to import token",
        });
      }
    }

    const successCount = results.filter((r) => r.status === "success").length;
    const failedCount = results.filter((r) => r.status === "failed").length;

    return NextResponse.json({
      success: true,
      imported: successCount,
      failed: failedCount,
      total: tokenList.length,
      results,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error.message || "Failed to import tokens" },
      { status: error.status || 500 }
    );
  }
}
