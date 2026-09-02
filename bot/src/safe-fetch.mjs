import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import https from "node:https";
import { brotliDecompressSync, gunzipSync, inflateSync } from "node:zlib";
import * as cheerio from "cheerio";
import ipaddr from "ipaddr.js";

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MIN_TEXT_CHARS = 500;
const MAX_TEXT_CHARS = 100_000;
const REDIRECT_CODES = new Set([301, 302, 303, 307, 308]);
const SUPPORTED_TYPES = new Set(["text/html", "text/plain"]);

export class IntakeError extends Error {
  constructor(code, message = code, permanent = true) {
    super(message);
    this.name = "IntakeError";
    this.code = code;
    this.permanent = permanent;
  }
}

export function isPublicAddress(address) {
  try {
    let parsed = ipaddr.parse(address);
    if (parsed.kind() === "ipv6" && parsed.isIPv4MappedAddress()) parsed = parsed.toIPv4Address();
    return parsed.range() === "unicast";
  } catch {
    return false;
  }
}

export async function fetchEligibleSource(sourceUrl, options = {}) {
  const resolveHost = options.resolveHost || defaultResolveHost;
  const request = options.request || requestPinnedHttps;
  const maxRedirects = options.maxRedirects ?? 3;
  let current = validateHttpsUrl(sourceUrl);

  for (let redirects = 0; ; redirects += 1) {
    const answers = await resolveAnswers(current.hostname, resolveHost);
    const selected = answers[0];
    const response = await request({
      url: current,
      address: selected.address,
      family: selected.family,
      maxBytes: MAX_RESPONSE_BYTES,
    });

    if (REDIRECT_CODES.has(Number(response.statusCode))) {
      if (redirects >= maxRedirects) throw new IntakeError("too_many_redirects");
      const location = header(response.headers, "location");
      if (!location) throw new IntakeError("redirect_without_location");
      current = validateHttpsUrl(new URL(location, current).toString());
      continue;
    }
    if (Number(response.statusCode) !== 200) throw new IntakeError("http_status", `HTTP ${response.statusCode}`);

    const contentType = String(header(response.headers, "content-type") || "").split(";", 1)[0].trim().toLowerCase();
    if (!SUPPORTED_TYPES.has(contentType)) throw new IntakeError("unsupported_content_type");
    const declaredLength = Number(header(response.headers, "content-length") || 0);
    if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) throw new IntakeError("response_too_large");

    const rawBody = await materializeBody(response.body, MAX_RESPONSE_BYTES);
    const body = decodeBody(rawBody, header(response.headers, "content-encoding"));
    if (body.byteLength > MAX_RESPONSE_BYTES) throw new IntakeError("response_too_large");
    const sourceSha256 = createHash("sha256").update(body).digest("hex");
    const decoded = body.toString("utf8");
    const extracted = contentType === "text/html" ? extractHtml(decoded, current) : {
      title: current.hostname,
      text: normalizeText(decoded),
    };
    if (extracted.text.length < MIN_TEXT_CHARS) throw new IntakeError("text_too_short");
    if (extracted.text.length > MAX_TEXT_CHARS) throw new IntakeError("text_too_long");
    assertNoAccessBarrier(extracted.text);

    return {
      finalUrl: current.toString(),
      contentType,
      title: extracted.title,
      text: extracted.text,
      sourceSha256,
      sourceBytes: body.byteLength,
    };
  }
}

async function resolveAnswers(hostname, resolver) {
  let answers;
  try {
    answers = await resolver(hostname);
  } catch (error) {
    throw new IntakeError("dns_error", safeMessage(error), false);
  }
  if (!Array.isArray(answers) || answers.length === 0) throw new IntakeError("dns_no_answers", "DNS returned no addresses", false);
  if (answers.some((answer) => !answer || !isPublicAddress(answer.address) || ![4, 6].includes(Number(answer.family)))) {
    throw new IntakeError("unsafe_dns_answer");
  }
  return answers.map((answer) => ({ address: answer.address, family: Number(answer.family) }));
}

async function defaultResolveHost(hostname) {
  if (ipaddr.isValid(hostname)) {
    const parsed = ipaddr.parse(hostname);
    return [{ address: hostname, family: parsed.kind() === "ipv4" ? 4 : 6 }];
  }
  return lookup(hostname, { all: true, verbatim: true });
}

function validateHttpsUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new IntakeError("unsafe_url");
  }
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443") || !url.hostname) {
    throw new IntakeError("unsafe_url");
  }
  return url;
}

export function requestPinnedHttps({ url, address, family, maxBytes = MAX_RESPONSE_BYTES }) {
  return new Promise((resolve, reject) => {
    let hardTimer;
    const request = https.request({
      protocol: "https:",
      hostname: url.hostname,
      port: 443,
      path: `${url.pathname}${url.search}`,
      method: "GET",
      servername: url.hostname,
      headers: {
        Accept: "text/html,text/plain;q=0.9",
        "Accept-Encoding": "identity",
        "User-Agent": "ArcURLSummaryBot/1.0 (+https://arc-agent-marketplace.vercel.app)",
      },
      lookup: (_hostname, lookupOptions, callback) => {
        if (lookupOptions?.all) callback(null, [{ address, family }]);
        else callback(null, address, family);
      },
      timeout: 15_000,
    }, (response) => {
      const chunks = [];
      let bytes = 0;
      response.on("data", (chunk) => {
        bytes += chunk.length;
        if (bytes > maxBytes) {
          response.destroy(new IntakeError("response_too_large"));
          return;
        }
        chunks.push(chunk);
      });
      response.on("end", () => {
        clearTimeout(hardTimer);
        resolve({
          statusCode: response.statusCode,
          headers: response.headers,
          body: Buffer.concat(chunks),
        });
      });
      response.on("error", (error) => {
        clearTimeout(hardTimer);
        reject(asNetworkError(error));
      });
    });
    hardTimer = setTimeout(() => request.destroy(new IntakeError("fetch_timeout", "Source fetch exceeded total time budget", false)), 30_000);
    hardTimer.unref?.();
    request.on("timeout", () => request.destroy(new IntakeError("fetch_timeout", "Source fetch timed out", false)));
    request.on("error", (error) => {
      clearTimeout(hardTimer);
      reject(asNetworkError(error));
    });
    request.end();
  });
}

function extractHtml(html, url) {
  const $ = cheerio.load(html);
  if ($('input[type="password"]').length > 0 || $('form[action*="login" i], form[action*="signin" i]').length > 0) {
    throw new IntakeError("authentication_required");
  }
  const title = normalizeText($("title").first().text()) || url.hostname;
  $("script,style,noscript,svg,canvas,template,nav,footer").remove();
  return { title, text: normalizeText($("body").text()) };
}

function assertNoAccessBarrier(text) {
  const sample = text.toLowerCase().slice(0, 20_000);
  const paywallSignals = [
    /subscribe to continue(?: reading)?/,
    /sign in to continue/,
    /log in to continue/,
    /register to continue/,
    /this (?:article|content) is for subscribers/,
    /access denied/,
    /enable cookies to continue/,
  ];
  if (paywallSignals.some((signal) => signal.test(sample))) throw new IntakeError("paywall_or_access_denied");
}

function normalizeText(value) {
  return String(value || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

async function materializeBody(body, maximum) {
  if (Buffer.isBuffer(body)) {
    if (body.byteLength > maximum) throw new IntakeError("response_too_large");
    return body;
  }
  if (typeof body === "string") return materializeBody(Buffer.from(body), maximum);
  const chunks = [];
  let size = 0;
  for await (const chunk of body || []) {
    const buffer = Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > maximum) throw new IntakeError("response_too_large");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

function decodeBody(body, encodingValue) {
  const encoding = String(encodingValue || "identity").toLowerCase().trim();
  try {
    if (!encoding || encoding === "identity") return body;
    const options = { maxOutputLength: MAX_RESPONSE_BYTES };
    if (encoding === "gzip") return gunzipSync(body, options);
    if (encoding === "deflate") return inflateSync(body, options);
    if (encoding === "br") return brotliDecompressSync(body, options);
  } catch {
    throw new IntakeError("invalid_content_encoding");
  }
  throw new IntakeError("unsupported_content_encoding");
}

function header(headers, name) {
  if (!headers) return undefined;
  if (typeof headers.get === "function") return headers.get(name);
  const value = headers[name] ?? headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function asNetworkError(error) {
  return error instanceof IntakeError ? error : new IntakeError("fetch_failed", safeMessage(error), false);
}

function safeMessage(error) {
  return String(error?.message || "Network request failed").replace(/https?:\/\/\S+/g, "[URL REDACTED]").slice(0, 300);
}
