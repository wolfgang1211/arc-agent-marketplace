import { recoverTypedDataAddress } from "viem";

export const REPORT_LIMIT = 16 * 1024;
export const REPORT_WARNING = "Verifier assessment of listed checks only. Not a guarantee of quality or truth. It does not pause escrow deadlines or decide disputes.";
export const VERDICT_COPY = Object.freeze({ checks_passed: "Checks passed", checks_failed: "Checks failed", inconclusive: "Inconclusive" });
const BINDINGS = Object.freeze(["chainId", "marketplace", "jobId", "client", "producer", "requestHash", "artifactURI", "artifactSha256", "criteriaHash", "verifier"]);
const FIELDS = Object.freeze(["schemaVersion", ...BINDINGS, "verdict", "signatureScheme", "signature"]);
const ADDRESS_FIELDS = ["marketplace", "client", "producer", "verifier"];
const HASH_FIELDS = ["requestHash", "artifactSha256", "criteriaHash"];
const MAX_UINT = (1n << 256n) - 1n;
const CURVE_ORDER = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const failure = (reason) => Object.freeze({ ok: false, reason });
const uint = (value) => /^(0|[1-9][0-9]{0,77})$/.test(value) && BigInt(value) <= MAX_UINT;
const hex = (value, bytes) => new RegExp(`^0x[0-9a-fA-F]{${bytes * 2}}$`).test(value) && !/^0x0+$/.test(value);

// This version accepts a flat JSON object of strings only. Tokenize before
// JSON.parse so duplicate keys (including escaped aliases) cannot disappear.
function flatJson(text) {
  if (typeof text !== "string" || text.length > REPORT_LIMIT || new TextEncoder().encode(text).length > REPORT_LIMIT) throw new Error();
  const token = /[ \t\r\n]*("(?:[^"\\\u0000-\u001f]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*"|[{}:,])/y;
  let position = 0;
  const next = () => {
    token.lastIndex = position;
    const match = token.exec(text);
    if (!match) throw new Error();
    position = token.lastIndex;
    return match[1];
  };
  if (next() !== "{") throw new Error();
  const result = Object.create(null);
  for (let i = 0; i < FIELDS.length; i++) {
    const rawKey = next();
    if (!rawKey.startsWith('"')) throw new Error();
    const key = JSON.parse(rawKey);
    if (!FIELDS.includes(key) || Object.hasOwn(result, key) || next() !== ":") throw new Error();
    const rawValue = next();
    if (!rawValue.startsWith('"')) throw new Error();
    result[key] = JSON.parse(rawValue);
    const end = next();
    if (end === "}") {
      if (!/^[ \t\r\n]*$/.test(text.slice(position)) || Object.keys(result).length !== FIELDS.length) throw new Error();
      return result;
    }
    if (end !== ",") throw new Error();
  }
  throw new Error();
}

function validBindings(value) {
  if (!uint(value.jobId) || !uint(value.chainId) || value.chainId === "0") return false;
  if (!ADDRESS_FIELDS.every((key) => hex(value[key], 20)) || !HASH_FIELDS.every((key) => hex(value[key], 32))) return false;
  if (value.verifier.toLowerCase() === value.client.toLowerCase() || value.verifier.toLowerCase() === value.producer.toLowerCase()) return false;
  const uri = value.artifactURI;
  if (!uri || uri.length > 2048 || new TextEncoder().encode(uri).length > 2048 || /[\s\u0000-\u001f\u007f\\]/.test(uri) || !uri.startsWith("https://")) return false;
  const parsed = new URL(uri);
  return parsed.protocol === "https:" && !!parsed.hostname && !parsed.username && !parsed.password && !parsed.hash;
}

export function parseVerifierReport(text) {
  try {
    const report = flatJson(text);
    if (report.schemaVersion !== "verifier-report-v1" || report.signatureScheme !== "eip712-eoa-preview-v1" || !Object.hasOwn(VERDICT_COPY, report.verdict) || !validBindings(report)) return failure("Invalid report fields.");
    if (!/^0x[0-9a-fA-F]{130}$/.test(report.signature)) return failure("Invalid signature encoding.");
    const r = BigInt(`0x${report.signature.slice(2, 66)}`);
    const s = BigInt(`0x${report.signature.slice(66, 130)}`);
    const v = report.signature.slice(130).toLowerCase();
    if (r === 0n || r >= CURVE_ORDER || s === 0n || s > CURVE_ORDER / 2n || !["1b", "1c"].includes(v)) return failure("Invalid signature encoding.");
    return Object.freeze({ ok: true, report: Object.freeze({ ...report }) });
  } catch {
    return failure("Invalid or oversized report JSON.");
  }
}

// Distinct primary type: NOT the proposed protocol-v0 AdvisoryRecord. There
// is deliberately no assignment, coordinator, challenge or signer activation.
export function reportTypedData(report) {
  return {
    domain: { name: "AlphaBoard Advisory Verifier", version: "0", chainId: BigInt(report.chainId), verifyingContract: report.marketplace },
    primaryType: "VerifierReportPreview",
    types: { VerifierReportPreview: [
      { name: "schemaVersion", type: "string" }, { name: "signatureScheme", type: "string" },
      { name: "jobId", type: "uint256" }, { name: "client", type: "address" },
      { name: "producer", type: "address" }, { name: "verifier", type: "address" },
      { name: "requestHash", type: "bytes32" }, { name: "artifactURI", type: "string" },
      { name: "artifactSha256", type: "bytes32" }, { name: "criteriaHash", type: "bytes32" },
      { name: "verdict", type: "string" },
    ] },
    message: {
      schemaVersion: report.schemaVersion, signatureScheme: report.signatureScheme,
      jobId: BigInt(report.jobId), client: report.client, producer: report.producer,
      verifier: report.verifier, requestHash: report.requestHash, artifactURI: report.artifactURI,
      artifactSha256: report.artifactSha256, criteriaHash: report.criteriaHash, verdict: report.verdict,
    },
  };
}

function expectedBindings(input) {
  const proto = Object.getPrototypeOf(input);
  if (proto !== Object.prototype && proto !== null) throw new Error();
  const keys = Reflect.ownKeys(input);
  if (keys.length !== BINDINGS.length || keys.some((key) => !BINDINGS.includes(key))) throw new Error();
  const copy = {};
  for (const key of BINDINGS) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (!descriptor || !Object.hasOwn(descriptor, "value") || typeof descriptor.value !== "string" || descriptor.value.length > 2048) throw new Error();
    copy[key] = descriptor.value;
  }
  if (!validBindings(copy)) throw new Error();
  return copy;
}

// Deterministic, side-effect-free async crypto; never RPC, fetch or wallet I/O.
// Success means signature + supplied bindings only, NOT protocol admission.
export async function validateVerifierReport(text, expected) {
  const parsed = parseVerifierReport(text);
  if (!parsed.ok) return parsed;
  try {
    const bindings = expectedBindings(expected);
    const report = parsed.report;
    for (const key of BINDINGS) {
      const isHex = ADDRESS_FIELDS.includes(key) || HASH_FIELDS.includes(key);
      if (isHex ? report[key].toLowerCase() !== bindings[key].toLowerCase() : report[key] !== bindings[key]) return failure("Report does not match the selected job or supplied evidence bindings.");
    }
    const signer = await recoverTypedDataAddress({ ...reportTypedData(report), signature: report.signature });
    if (signer.toLowerCase() !== report.verifier.toLowerCase()) return failure("Signature does not match the selected verifier.");
    return Object.freeze({ ok: true, authority: "advisory_only", report });
  } catch {
    return failure("Evidence bindings or signature could not be validated.");
  }
}
