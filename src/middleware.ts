import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { createMiddlewareClient } from "@/lib/supabase/middleware";

const AUTH_ROUTES = new Set(["/login", "/signup"]);

const PROTECTED_PREFIXES = [
  "/dashboard",
  "/products",
  "/inventory",
  "/suppliers",
  "/purchase-orders",
  "/forecasting",
  "/alerts",
  "/settings",
];

function isProtectedPath(pathname: string) {
  return PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

function copyResponseCookies(source: NextResponse, target: NextResponse) {
  source.cookies.getAll().forEach((cookie) => {
    target.cookies.set(cookie.name, cookie.value);
  });
}

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  const { supabase, response } = await createMiddlewareClient(request);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const url = request.nextUrl.clone();

  if (pathname === "/") {
    url.pathname = user ? "/dashboard" : "/login";
    const redirectResponse = NextResponse.redirect(url);
    copyResponseCookies(response, redirectResponse);
    return redirectResponse;
  }

  if (AUTH_ROUTES.has(pathname) && user) {
    url.pathname = "/dashboard";
    const redirectResponse = NextResponse.redirect(url);
    copyResponseCookies(response, redirectResponse);
    return redirectResponse;
  }

  if (isProtectedPath(pathname) && !user) {
    url.pathname = "/login";
    const redirectResponse = NextResponse.redirect(url);
    copyResponseCookies(response, redirectResponse);
    return redirectResponse;
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};