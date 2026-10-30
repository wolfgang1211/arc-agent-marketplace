import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';

export function scratchDir() {
  const dir = process.env.TMPDIR || tmpdir();
  mkdirSync(dir, { recursive: true });
  return dir;
}
