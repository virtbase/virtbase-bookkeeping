import { timingSafeEqual } from "node:crypto";
import type { Context, MiddlewareHandler } from "hono";
import { getCookie, setCookie } from "hono/cookie";

const COOKIE = "bookkeeping_session";
const PRESENCE_PATH = "/api/presence";
const contentSecurityPolicy = (port: number) =>
  [
    "default-src 'self'",
    `connect-src 'self' ws://127.0.0.1:${port}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");
const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export interface SessionState {
  port: number;
  bootstrapToken: string | null;
  sessionToken: string;
}

export function randomToken(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString(
    "hex",
  );
}

export function createSessionState(port = 0): SessionState {
  return { port, bootstrapToken: randomToken(), sessionToken: randomToken() };
}

export function sameToken(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function reject(context: Context, status: 401 | 403): Response {
  return context.text(
    status === 401 ? "Bitte die App neu öffnen." : "Anfrage abgelehnt.",
    status,
  );
}

export function guard(state: SessionState): MiddlewareHandler {
  return async (context, next) => {
    const expectedHost = `127.0.0.1:${state.port}`;
    if (context.req.header("host") !== expectedHost) {
      return reject(context, 403);
    }

    const url = new URL(context.req.url);
    const isApi = url.pathname.startsWith("/api/");
    const isUnsafe = UNSAFE_METHODS.has(context.req.method);
    const fetchSite = context.req.header("sec-fetch-site");
    const isPresence =
      url.pathname === PRESENCE_PATH &&
      context.req.header("upgrade")?.toLowerCase() === "websocket";

    if (
      (isUnsafe || isPresence) &&
      context.req.header("origin") !== `http://${expectedHost}`
    ) {
      return reject(context, 403);
    }
    if ((isApi || isUnsafe) && !isPresence && fetchSite !== "same-origin") {
      return reject(context, 403);
    }

    const token = url.searchParams.get("token");
    if (url.pathname === "/" && token !== null) {
      if (!state.bootstrapToken || !sameToken(token, state.bootstrapToken)) {
        return reject(context, 401);
      }
      state.bootstrapToken = null;
      setCookie(context, COOKIE, state.sessionToken, {
        httpOnly: true,
        sameSite: "Strict",
        path: "/",
      });
      return context.redirect("/");
    }

    const session = getCookie(context, COOKIE);
    if (!session || !sameToken(session, state.sessionToken)) {
      return reject(context, 401);
    }
    await next();
  };
}

export function securityHeaders(state: SessionState): MiddlewareHandler {
  return async (context, next) => {
    await next();
    context.header(
      "Content-Security-Policy",
      contentSecurityPolicy(state.port),
    );
    context.header("X-Content-Type-Options", "nosniff");
    context.header("X-Frame-Options", "DENY");
    context.header("Referrer-Policy", "no-referrer");
    context.header("Cache-Control", "no-store");
  };
}
