import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const nextBin = path.join(projectRoot, "node_modules", "next", "dist", "bin", "next");
const args = process.argv.slice(2);

const env = { ...process.env };

if (process.platform === "win32" && process.env.NEXT_BUILD_REAL_HOME !== "1") {
  const buildHome = path.join(projectRoot, ".data-wyx0", "build-home");
  const roaming = path.join(buildHome, "AppData", "Roaming");
  const local = path.join(buildHome, "AppData", "Local");

  fs.mkdirSync(roaming, { recursive: true });
  fs.mkdirSync(local, { recursive: true });

  env.HOME = buildHome;
  env.USERPROFILE = buildHome;
  env.APPDATA = roaming;
  env.LOCALAPPDATA = local;
}

const child = spawn(process.execPath, [nextBin, "build", "--webpack", ...args], {
  cwd: projectRoot,
  env,
  stdio: "inherit",
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});

