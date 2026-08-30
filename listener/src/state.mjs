import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export function createFileState(path) {
  return {
    async load() {
      try {
        const parsed = JSON.parse(await readFile(path, "utf8"));
        if (!/^\d+$/.test(String(parsed.blockNumber)) || !Number.isInteger(parsed.logIndex)) {
          throw new Error("invalid cursor fields");
        }
        return {
          blockNumber: String(parsed.blockNumber),
          logIndex: parsed.logIndex,
          transactionHash: parsed.transactionHash || null,
        };
      } catch (error) {
        if (error.code === "ENOENT") return null;
        throw new Error(`Listener state is unreadable: ${error.message}`);
      }
    },
    async save(cursor) {
      await mkdir(dirname(path), { recursive: true });
      const temporary = `${path}.${process.pid}.tmp`;
      await writeFile(temporary, `${JSON.stringify(cursor, null, 2)}\n`, "utf8");
      await rename(temporary, path);
    },
  };
}
