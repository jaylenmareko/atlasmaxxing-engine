// HTTP Basic Auth over the whole site — one shared username/password from
// env, not an account system. This is a two-person internal tool; the point is
// to keep the deployed URL from being wide open, not to model identity.
//
// If BASIC_AUTH_USER / BASIC_AUTH_PASS are unset the gate is skipped entirely,
// so local `npm run dev` doesn't prompt. That also means: forgetting to set
// them on Render leaves the site public. They're required env vars there.
//
// This is Next 16's `proxy.ts` convention — what earlier versions called
// `middleware.ts`. Same functionality, renamed file and renamed export; the
// old name still works but builds emit a deprecation warning.

import { NextResponse, type NextRequest } from "next/server";

/** Length-independent compare, so a wrong password can't be narrowed by timing. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function proxy(request: NextRequest) {
  const user = process.env.BASIC_AUTH_USER;
  const pass = process.env.BASIC_AUTH_PASS;
  if (!user || !pass) return NextResponse.next();

  const header = request.headers.get("authorization");
  if (header?.startsWith("Basic ")) {
    try {
      const decoded = atob(header.slice(6));
      // Split on the FIRST colon only — a password may legally contain colons.
      const sep = decoded.indexOf(":");
      if (sep !== -1) {
        const gotUser = decoded.slice(0, sep);
        const gotPass = decoded.slice(sep + 1);
        if (safeEqual(gotUser, user) && safeEqual(gotPass, pass)) {
          return NextResponse.next();
        }
      }
    } catch {
      // malformed base64 — fall through to the 401
    }
  }

  return new NextResponse("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Engine", charset="UTF-8"' },
  });
}

export const config = {
  // Everything except Next's own static output and /healthz. /api/* IS gated —
  // the browser replays Basic credentials automatically on same-origin
  // fetches, so the transcript route stays behind the same door as the pages.
  //
  // /healthz is exempt because Render's health check sends no credentials; a
  // gated health endpoint would 401 and fail every deploy. It returns nothing
  // but "ok" — see src/app/healthz/route.ts.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|healthz).*)"],
};
