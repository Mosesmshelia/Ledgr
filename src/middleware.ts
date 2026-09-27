// Passes the requested path to server components, so the permission check in requireCtx can see it
// before any page queries run (layouts and pages render in parallel, so a layout guard alone isn't enough).
import { NextResponse, type NextRequest } from "next/server";

export function middleware(req: NextRequest) {
  const headers = new Headers(req.headers);
  headers.set("x-ledgr-path", req.nextUrl.pathname + req.nextUrl.search);
  return NextResponse.next({ request: { headers } });
}

export const config = { matcher: ["/((?!_next/|api/|favicon.ico|.*\\.(?:png|svg|ico|ttf|woff2?)$).*)"] };
