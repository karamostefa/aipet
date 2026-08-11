import { NextRequest, NextResponse } from 'next/server';
import { locales, defaultLocale } from '@/i18n/config';
import { verifySession, SESSION_COOKIE_NAME } from '@/lib/auth';

function getLocaleFromRequest(req: NextRequest): string {
  const header = req.headers.get('accept-language') || '';
  const preferred = header.split(',')[0]?.split('-')[0];
  return (locales as readonly string[]).includes(preferred) ? preferred : defaultLocale;
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // --- Admin area: guard everything under /admin except the login page ---
  if (pathname.startsWith('/admin') && pathname !== '/admin/login') {
    const token = req.cookies.get(SESSION_COOKIE_NAME)?.value;
    const session = token ? await verifySession(token) : null;
    if (!session) {
      const loginUrl = new URL('/admin/login', req.url);
      return NextResponse.redirect(loginUrl);
    }
    return NextResponse.next();
  }

  // --- API routes: no locale rewriting needed ---
  if (pathname.startsWith('/api') || pathname.startsWith('/admin')) {
    return NextResponse.next();
  }

  // --- Public site: ensure every path is locale-prefixed (/en/... or /ar/...) ---
  const pathnameHasLocale = locales.some(
    (locale) => pathname.startsWith(`/${locale}/`) || pathname === `/${locale}`
  );
  if (pathnameHasLocale) return NextResponse.next();

  const locale = getLocaleFromRequest(req);
  const newUrl = new URL(`/${locale}${pathname}`, req.url);
  return NextResponse.redirect(newUrl);
}

export const config = {
  matcher: [
    // Skip static assets and image optimization files.
    '/((?!_next/static|_next/image|favicon.ico|logo|images|manifest.json).*)',
  ],
};
