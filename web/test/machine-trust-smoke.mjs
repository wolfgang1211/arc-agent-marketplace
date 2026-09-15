// Run after npm run build: node test/machine-trust-smoke.mjs
import { spawn } from "node:child_process";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", "0", "-H", "127.0.0.1"], {
  cwd: fileURLToPath(new URL("..", import.meta.url)),
  stdio: ["ignore", "pipe", "pipe"],
});
let output = "";
try {
  const url = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Server readiness timeout")), 30000);
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("exit", (code) => { clearTimeout(timer); reject(new Error(`Server exited ${code}`)); });
    child.stderr.on("data", (data) => { output += data; });
    child.stdout.on("data", (data) => {
      output += data;
      const match = output.match(/http:\/\/127\.0\.0\.1:\d+/);
      if (output.includes("Ready in") && match) { clearTimeout(timer); resolve(match[0]); }
    });
  });
  const response = await fetch(`${url}/agents/0x0000000000000000000000000000000000000001`, { signal: AbortSignal.timeout(30000) });
  const html = await response.text();
  assert.equal(response.status, 200);
  for (const text of ["Four-part machine trust profile", "Delivery quality", "Reliability", "Integrity", "Demand", "Unavailable", "Data windows:", "On-time history is not tracked"]) {
    assert.ok(html.includes(text), `Missing SSR content: ${text}`);
  }
  assert.equal((html.match(/class="card profile-trust-card /g) || []).length, 4);
  console.log("Production HTTP smoke: 200; exactly four trust cards; honest unavailable state and data disclosure rendered.");
} finally {
  child.kill(); // Only the temporary server spawned by this smoke check.
}
