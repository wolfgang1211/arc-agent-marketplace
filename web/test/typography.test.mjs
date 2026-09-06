import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const layoutSource = await readFile(new URL("../app/layout.js", import.meta.url), "utf8");
const cssSource = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

test("self-hosted Geist typography is applied to the root layout", () => {
  assert.match(layoutSource, /import \{ GeistSans \} from "geist\/font\/sans"/);
  assert.match(layoutSource, /import \{ GeistMono \} from "geist\/font\/mono"/);
  assert.match(layoutSource, /GeistSans\.variable/);
  assert.match(layoutSource, /GeistMono\.variable/);
  assert.match(cssSource, /--font-sans:\s*var\(--font-geist-sans\)/);
  assert.match(cssSource, /--font-mono:\s*var\(--font-geist-mono\)/);
  assert.match(cssSource, /body\s*\{[\s\S]*?font-family:\s*var\(--font-sans\)/);
  assert.match(cssSource, /\.mono\s*\{[^}]*font-family:\s*var\(--font-mono\)/);
});

test("technical marketplace labels use the shared mono token", () => {
  assert.match(cssSource, /\.environment-badge\s*\{[\s\S]*?var\(--font-mono\)/);
  assert.match(cssSource, /\.eyebrow\s*\{[^}]*font-family:\s*var\(--font-mono\)/);
  assert.match(cssSource, /\.metric-label\s*\{[^}]*var\(--font-mono\)/);
  assert.doesNotMatch(cssSource, /font-family:\s*ui-(?:sans-serif|monospace)/);
});
