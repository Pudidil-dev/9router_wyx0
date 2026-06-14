import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { clearDashboardAuthCookie } from "@/lib/auth/dashboardSession";
import { OIDC_COOKIE_NAMES } from "@/lib/auth/oidc";

export async function POST() {
  const cookieStore = await cookies();
  clearDashboardAuthCookie(cookieStore);
  cookieStore.delete(OIDC_COOKIE_NAMES.state);
  cookieStore.delete(OIDC_COOKIE_NAMES.nonce);
  cookieStore.delete(OIDC_COOKIE_NAMES.verifier);
  return NextResponse.json({ success: true });
}
