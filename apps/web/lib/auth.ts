import 'server-only';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { nextCookies } from 'better-auth/next-js';
import { account, db, session, user, verification } from '@opengeo/db';
import { signupAllowed } from './limits';

export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL ?? 'http://localhost:3010',
  secret: process.env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, {
    provider: 'pg',
    schema: { user, session, account, verification },
  }),
  // OPENGEO_ALLOW_SIGNUP=false: keine Selbstregistrierung (auch nicht direkt über die API)
  emailAndPassword: { enabled: true, minPasswordLength: 8, autoSignIn: true, disableSignUp: !signupAllowed() },
  session: { expiresIn: 60 * 60 * 24 * 30 },
  telemetry: { enabled: false },
  plugins: [nextCookies()],
});
