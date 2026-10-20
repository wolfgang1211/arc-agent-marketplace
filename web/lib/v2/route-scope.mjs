// Callers must pass the unparsed pathname only; reject ambiguous encodings and syntax.
const isRawPathname = (value) => {
  if (typeof value !== "string" || !value.startsWith("/")) return false;
  if (/[\u0000-\u001f\u007f\u0080-\u009f\u2028\u2029\\?#%]/u.test(value)) return false;

  const segments = value.split("/");
  return segments.every((segment, index) => {
    if (segment === "" && index > 0 && index !== segments.length - 1) return false;
    return segment !== "." && segment !== "..";
  });
};

const inNamespace = (pathname, namespace) =>
  isRawPathname(pathname) && (pathname === namespace || pathname.startsWith(`${namespace}/`));

export const isV2Route = (pathname) => inNamespace(pathname, "/v2");

export const isV2ApiRoute = (pathname) => inNamespace(pathname, "/api/v2");

export const classifyRoute = (pathname) => {
  if (isV2ApiRoute(pathname)) return { version: "v2", namespace: "api/v2" };
  if (isV2Route(pathname)) return { version: "v2", namespace: "v2" };
  if (inNamespace(pathname, "/jobs")) return { version: "v1", namespace: "" };
  return { version: "unknown", namespace: "" };
};

export const compositeJobIdentity = ({ chainId, marketId, jobId }) =>
  `${String(chainId)}:${String(marketId)}:${String(jobId)}`;
