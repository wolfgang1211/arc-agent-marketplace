import { createSourcePreflightHandler } from "../../../lib/server/source-preflight.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;
export const POST = createSourcePreflightHandler();
