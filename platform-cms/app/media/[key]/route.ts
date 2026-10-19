import { getBucket, mediaKey, getD1 } from "@/lib/cms";

import { assertIsolatedD1Scope } from "@/lib/access";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ key: string }> }) {
  const { key: requested } = await context.params;
  const key = mediaKey(requested);
  if (!key) return new Response("Not found", { status: 404 });
  try {
    await assertIsolatedD1Scope(getD1());
    const object = await getBucket().get(key);
    if (!object) return new Response("Not found", { status: 404 });
    const type = object.httpMetadata?.contentType;
    if (type !== "image/png" && type !== "image/jpeg" && type !== "image/webp") return new Response("Not found", { status: 404 });
    return new Response(object.body, { headers: {
      "content-type": type,
      "x-robots-tag": "noindex, nofollow",
      "content-length": String(object.size),
      "cache-control": "public, max-age=31536000, immutable",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; sandbox",
    } });
  } catch (error) {
    console.error("Media unavailable", error);
    return new Response("Temporarily unavailable", { status: 503, headers: { "cache-control": "no-store" } });
  }
}
