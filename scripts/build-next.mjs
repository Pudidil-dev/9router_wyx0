import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const traceHome = join(projectRoot, ".next-trace-home");
const appData = join(traceHome, "AppData", "Roaming");
const localAppData = join(traceHome, "AppData", "Local");

for (const dir of [traceHome, appData, localAppData, join(traceHome, ".config")]) {
  mkdirSync(dir, { recursive: true });
}

const env = {
  ...process.env,
  HOME: traceHome,
  USERPROFILE: traceHome,
  APPDATA: appData,
  LOCALAPPDATA: localAppData,
  XDG_CONFIG_HOME: join(traceHome, ".config"),
  NEXT_TELEMETRY_DISABLED: "1",
};

const nextBin = require.resolve("next/dist/bin/next");
const args = ["build", "--webpack", ...process.argv.slice(2)];
const child = spawn(process.execPath, [nextBin, ...args], {
  cwd: projectRoot,
  env,
  stdio: "inherit",
  windowsHide: true,
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
