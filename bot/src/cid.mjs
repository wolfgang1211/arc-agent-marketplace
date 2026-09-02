import { CID } from "multiformats/cid";

export function isValidCid(value) {
  if (typeof value !== "string" || value.length === 0) return false;
  try {
    return CID.parse(value).toString() === value;
  } catch {
    return false;
  }
}
