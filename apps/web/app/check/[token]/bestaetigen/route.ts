import { NextResponse, type NextRequest } from 'next/server';
import { verifyCheckEmail } from '@/lib/hosted/data';
import { CHECK_VERIFIED_COOKIE, isHosted } from '@/lib/hosted/server';

const TOKEN_RE = /^[A-Za-z0-9_-]{16,128}$/;

/** Link aus der Bestätigungsmail: Code prüfen, dann zurück zum Check (Fehler werden dort freundlich erklärt). */
export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!isHosted() || !TOKEN_RE.test(token)) return new NextResponse('Not found', { status: 404 });
  const code = req.nextUrl.searchParams.get('code')?.slice(0, 200) ?? '';
  const r = code ? await verifyCheckEmail(token, code) : { error: 'code_invalid' as const };
  // schon bestätigt (zweiter Klick) ist kein Fehler – die Seite zeigt einfach den Stand
  const q = 'ok' in r ? '?bestaetigt=1' : r.error !== 'wrong_state' ? `?fehler=${encodeURIComponent(r.error)}` : '';
  // relativ umleiten (nicht vom Host-Header abhängig)
  const res = new NextResponse(null, { status: 303, headers: { Location: `/check/${token}${q}`, 'Referrer-Policy': 'no-referrer' } });
  // dieser Browser hat die Adresse bestätigt → nur hier darf die Registrierung die E-Mail vorbelegen
  if ('ok' in r || r.error === 'wrong_state') {
    res.cookies.set(CHECK_VERIFIED_COOKIE, token, { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 7 * 24 * 3600, secure: req.nextUrl.protocol === 'https:' });
  }
  return res;
}
