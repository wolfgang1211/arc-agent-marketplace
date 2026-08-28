import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const debuggerUrl = "http://127.0.0.1:9222";
const fixtureUrl = "http://127.0.0.1:4173/test/fixtures/timeout-recovery-evidence.html";
const outputDir = fileURLToPath(new URL("../docs/evidence/timeout-recovery/", import.meta.url));

const version = await fetch(`${debuggerUrl}/json/version`).then((response) => {
  if (!response.ok) throw new Error(`Brave DevTools endpoint returned ${response.status}`);
  return response.json();
});

const socket = new WebSocket(version.webSocketDebuggerUrl);
const pending = new Map();
let nextId = 1;

socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (!message.id || !pending.has(message.id)) return;
  const { resolve, reject } = pending.get(message.id);
  pending.delete(message.id);
  if (message.error) reject(new Error(message.error.message));
  else resolve(message.result);
});

await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});

function send(method, params = {}, sessionId) {
  const id = nextId++;
  socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

async function capture(name, view, width, height, mobile) {
  const { targetId } = await send("Target.createTarget", {
    url: "about:blank",
    background: true,
  });
  try {
    const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
    await send("Page.enable", {}, sessionId);
    await send("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: 1,
      mobile,
    }, sessionId);
    await send("Page.navigate", { url: `${fixtureUrl}?view=${view}` }, sessionId);
    await new Promise((resolve) => setTimeout(resolve, 750));
    await send("Runtime.evaluate", {
      expression: "document.fonts.ready",
      awaitPromise: true,
      returnByValue: true,
    }, sessionId);
    const { data } = await send("Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
      captureBeyondViewport: false,
    }, sessionId);
    const path = `${outputDir}${name}.png`;
    await writeFile(path, Buffer.from(data, "base64"));
    console.log(`${name}: ${width}x${height} -> ${path}`);
  } finally {
    await send("Target.closeTarget", { targetId });
  }
}

await mkdir(outputDir, { recursive: true });
await capture("desktop-states", "states", 1440, 900, false);
await capture("desktop-dispute", "dispute", 1440, 900, false);
await capture("mobile-states", "states", 390, 844, true);
await capture("mobile-dispute", "dispute", 390, 844, true);
socket.close();
