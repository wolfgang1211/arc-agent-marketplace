import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const DEFAULT_ROOT = fileURLToPath(new URL("../", import.meta.url));

export function computeBuildFingerprint(root = DEFAULT_ROOT) {
  const normalizedRoot = resolve(root);
  const files = ["package.json", "package-lock.json", ...walkSource(normalizedRoot, "src")].sort();
  const hash = createHash("sha256");
  for (const relativePath of files) {
    hash.update(relativePath, "utf8");
    hash.update("\0");
    hash.update(readFileSync(resolve(normalizedRoot, relativePath)));
    hash.update("\0");
  }
  return hash.digest("hex");
}

function walkSource(root, relativeDirectory) {
  const absoluteDirectory = resolve(root, relativeDirectory);
  const files = [];
  for (const entry of readdirSync(absoluteDirectory, { withFileTypes: true })) {
    const relativePath = `${relativeDirectory}/${entry.name}`.replaceAll("\\", "/");
    if (entry.isDirectory()) files.push(...walkSource(root, relativePath));
    else if (entry.isFile() && entry.name.endsWith(".mjs")) files.push(relativePath);
  }
  return files;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify({ buildFingerprint: computeBuildFingerprint() }));
}
