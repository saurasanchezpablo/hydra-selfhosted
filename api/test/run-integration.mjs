// Boots the API on a scratch database, runs the integration suite against it,
// and tears it down. Used by `npm run test:integration`.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const apiRoot = path.resolve(here, "..");
const entry = path.join(apiRoot, "dist", "index.js");

if (!fs.existsSync(entry)) {
  console.error("dist/index.js is missing — run `npm run build` first.");
  process.exit(1);
}

const port = Number(process.env.ITEST_PORT ?? 3999);
const token = "itest-secret";
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "hydra-selfhosted-itest-"));

const server = spawn(process.execPath, [entry], {
  cwd: apiRoot,
  env: {
    ...process.env,
    API_TOKEN: token,
    PORT: String(port),
    DATA_DIR: dataDir,
    NODE_ENV: "test",
  },
  stdio: ["ignore", "pipe", "pipe"],
});

const serverLog = [];
server.stdout.on("data", (chunk) => serverLog.push(chunk.toString()));
server.stderr.on("data", (chunk) => serverLog.push(chunk.toString()));

const base = `http://127.0.0.1:${port}`;
const cleanup = () => {
  server.kill("SIGTERM");
  fs.rmSync(dataDir, { recursive: true, force: true });
};

const waitForHealth = async () => {
  for (let attempt = 0; attempt < 60; attempt++) {
    if (server.exitCode !== null) {
      throw new Error(
        `API exited early (code ${server.exitCode}):\n${serverLog.join("")}`
      );
    }
    try {
      const res = await fetch(`${base}/health`);
      if (res.ok) return;
    } catch {
      // not listening yet
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`API did not become healthy:\n${serverLog.join("")}`);
};

try {
  await waitForHealth();

  const suite = spawn(
    process.execPath,
    [path.join(here, "cloud-saves.integration.mjs")],
    {
      cwd: apiRoot,
      env: { ...process.env, ITEST_BASE: base, ITEST_TOKEN: token },
      stdio: "inherit",
    }
  );

  const code = await new Promise((resolve) => suite.on("exit", resolve));
  cleanup();
  process.exit(code ?? 1);
} catch (error) {
  console.error(error.message);
  cleanup();
  process.exit(1);
}
