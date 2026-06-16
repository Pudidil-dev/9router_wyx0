import { NextResponse } from "next/server";
import os from "node:os";

export const dynamic = "force-dynamic";

function recommendWorkers({ cpuThreads, totalMemoryGb, maxWorkers = 8 }) {
  const cpuLimit = cpuThreads >= 12 ? 6 : cpuThreads >= 8 ? 4 : cpuThreads >= 4 ? 3 : 1;
  const memoryLimit = totalMemoryGb >= 16 ? 6 : totalMemoryGb >= 8 ? 4 : totalMemoryGb >= 4 ? 3 : 1;
  return Math.min(maxWorkers, Math.max(1, Math.min(cpuLimit, memoryLimit)));
}

export async function GET() {
  const cpuThreads = Math.max(1, os.cpus()?.length || 1);
  const totalMemoryGb = Math.max(1, Math.round((os.totalmem() / 1024 ** 3) * 10) / 10);
  const recommendedWorkers = recommendWorkers({ cpuThreads, totalMemoryGb });

  return NextResponse.json({
    cpuThreads,
    totalMemoryGb,
    recommendedWorkers,
    maxWorkers: 8,
    source: "server",
  });
}
