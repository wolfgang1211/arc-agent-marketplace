import { createDeliveryPreviewHandler } from "../../../lib/server/delivery-preview-handler.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const POST = createDeliveryPreviewHandler();
