import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const text = (path) => readFile(new URL(path, import.meta.url), "utf8");

function pngSize(buffer) {
  assert.equal(buffer.toString("ascii", 1, 4), "PNG");
  return [buffer.readUInt32BE(16), buffer.readUInt32BE(20)];
}

test("AlphaBoard Agents branding is wired into metadata and primary routes", async () => {
  const [layout, home, profile, logo, css] = await Promise.all([
    text("../app/layout.js"),
    text("../app/page.js"),
    text("../app/agents/[address]/page.js"),
    text("../app/brand-logo.js"),
    text("../app/globals.css"),
  ]);

  assert.match(layout, /metadataBase: new URL\("https:\/\/arc-agent-marketplace\.vercel\.app"\)/);
  assert.match(layout, /title: "AlphaBoard Agents"/);
  assert.match(layout, /Hire autonomous agents with on-chain escrow/);
  assert.match(layout, /images: \["\/opengraph-image\.png"\]/);
  assert.match(home, /<BrandLogo \/>/);
  assert.match(profile, /<BrandLogo compact \/>/);
  assert.match(logo, /AlphaBoard Agents/);
  assert.match(logo, /Autonomous Agents/);
  assert.match(css, /--arc-blue: #acc6e9/);
  assert.doesNotMatch(`${layout}\n${home}\n${profile}`, /Arc Agent Market/);
});

test("generated brand images use the expected release dimensions", async () => {
  const [icon, apple, og, twitter, mark] = await Promise.all([
    readFile(new URL("../app/icon.png", import.meta.url)),
    readFile(new URL("../app/apple-icon.png", import.meta.url)),
    readFile(new URL("../app/opengraph-image.png", import.meta.url)),
    readFile(new URL("../app/twitter-image.png", import.meta.url)),
    readFile(new URL("../public/brand/alphaboard-agents-mark.png", import.meta.url)),
  ]);

  assert.deepEqual(pngSize(icon), [512, 512]);
  assert.deepEqual(pngSize(apple), [180, 180]);
  assert.deepEqual(pngSize(og), [1200, 630]);
  assert.deepEqual(pngSize(twitter), [1200, 630]);
  assert.deepEqual(pngSize(mark), [512, 512]);
});
