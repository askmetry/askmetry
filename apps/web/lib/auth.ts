import 'server-only';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { nextCookies } from 'better-auth/next-js';
import { account, db, session, user, verification } from '@askmetry/db';
import { isHosted } from '@askmetry/core/hosted/config';
import { mailTemplates, sendMail } from '@askmetry/core/mail';
import { signupAllowed } from './limits';
import { LOCALE_COOKIE, resolveLocale } from './i18n/config';

/** UI-Sprache der Anfrage (Cookie → Accept-Language) für Auth-Mails. */
function requestLocale(req?: Request): 'de' | 'en' {
  const cookie = req?.headers.get('cookie')?.split(/;\s*/).find((c) => c.startsWith(`${LOCALE_COOKIE}=`))?.split('=')[1];
  return resolveLocale({ cookie, acceptLanguage: req?.headers.get('accept-language') ?? null });
}

// Gehostete Version (ASKMETRY_HOSTED=1): E-Mail-Bestätigung Pflicht, Passwort zurücksetzen per Mail.
// Selbst gehostet bleibt alles wie bisher (keine Mails, automatische Anmeldung nach der Registrierung).
const hosted = isHosted();

export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL ?? 'http://localhost:3010',
  secret: process.env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, {
    provider: 'pg',
    schema: { user, session, account, verification },
  }),
  // ASKMETRY_ALLOW_SIGNUP=false: keine Selbstregistrierung (auch nicht direkt über die API)
  emailAndPassword: {
    enabled: true, minPasswordLength: 8, autoSignIn: true, disableSignUp: !signupAllowed(),
    ...(hosted ? {
      requireEmailVerification: true,
      revokeSessionsOnPasswordReset: true,
      resetPasswordTokenExpiresIn: 60 * 60,
      sendResetPassword: async ({ user: u, url }, req) => {
        await sendMail({ to: u.email, ...mailTemplates.authReset({ lang: requestLocale(req), url }) });
      },
    } : {}),
  },
  ...(hosted ? {
    emailVerification: {
      sendOnSignUp: true,
      // unbestätigt anmelden → Link erneut schicken (Fehler EMAIL_NOT_VERIFIED in der UI)
      sendOnSignIn: true,
      autoSignInAfterVerification: true,
      expiresIn: 60 * 60 * 24,
      sendVerificationEmail: async ({ user: u, url }, req) => {
        await sendMail({ to: u.email, ...mailTemplates.authVerify({ lang: requestLocale(req), url }) });
      },
    },
  } : {}),
  session: { expiresIn: 60 * 60 * 24 * 30 },
  telemetry: { enabled: false },
  plugins: [nextCookies()],
});
