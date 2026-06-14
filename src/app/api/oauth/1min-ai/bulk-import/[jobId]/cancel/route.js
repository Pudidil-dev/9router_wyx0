import { NextResponse } from "next/server";
import { getOneMinBulkImportManager } from "@/lib/oauth/services/oneMinBulkImportManager";

export const dynamic = "force-dynamic";

export async function POST(_request, { params }) {
  const { jobId } = await params;
  const manager = getOneMinBulkImportManager();
  const job = manager.cancelJob(jobId);

  if (!job) {
    return NextResponse.json({ error: "Bulk import job not found" }, { status: 404 });
  }

  return NextResponse.json({
    success: true,
    job,
  });
}
