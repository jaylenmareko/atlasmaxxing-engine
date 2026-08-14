// Unauthenticated health check for Render.
//
// This exists specifically because the site is behind Basic Auth: Render's
// health check sends no credentials, so pointing it at "/" would get a 401
// and Render would mark every deploy unhealthy. src/proxy.ts excludes this
// path from the auth gate for that reason.
//
// It deliberately reports nothing but liveness — no versions, no env, no
// dependency status — since it's the one route reachable without a password.

export const dynamic = "force-dynamic";

export function GET() {
  return new Response("ok", {
    status: 200,
    headers: { "content-type": "text/plain", "cache-control": "no-store" },
  });
}
