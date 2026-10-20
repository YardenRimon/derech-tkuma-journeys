import { createServerClient } from '@supabase/ssr';
import { AUTH_COOKIE, PlatformAuthError } from './platform-auth-core';
import type { PlatformProviderFactory } from './platform-auth-core';

/** Transport exists only in this server-side module. A fresh SDK instance and
 * cookie jar belong to one request; neither is cached or exposed to the UI. */
export const createManagedPlatformProvider: PlatformProviderFactory = (config, jar) => {
  const client = createServerClient(config.url, config.publishableKey, {
    cookieOptions: { name: AUTH_COOKIE, path: '/', secure: true, httpOnly: true, sameSite: 'lax', maxAge: 28800 },
    // Raw encoding avoids the SDK's malformed-base64 diagnostics containing
    // untrusted cookie contents. The jar safely percent-encodes cookie values.
    cookieEncoding: 'raw',
    cookies: {
      getAll: () => jar.getAll(),
      setAll: (cookies) => jar.setAll(cookies),
    },
    auth: { flowType: 'pkce', autoRefreshToken: false, detectSessionInUrl: false, debug: false },
    global: {
      fetch: async (input, init) => {
        const target = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
        if (target.origin !== config.url || !target.pathname.startsWith('/auth/v1/')) {
          throw new PlatformAuthError(503, 'auth_unavailable');
        }
        // Never forward this request's cookies, headers, or origin to a second
        // host through an upstream redirect. Supabase receives its own SDK data.
        return fetch(input, { ...init, redirect: 'manual', signal: AbortSignal.timeout(10000) });
      },
    },
  });
  async function call<T extends { error: unknown }>(promise: Promise<T>): Promise<T> {
    try {
      const result = await promise;
      const error = result.error as { status?: number; name?: string } | null;
      if (error?.status === 429) throw new PlatformAuthError(429, 'rate_limited');
      if (error && ((error.status ?? 0) >= 500 || error.name === 'AuthRetryableFetchError')) {
        throw new PlatformAuthError(503, 'auth_unavailable');
      }
      return result;
    } catch (error) {
      if (error instanceof PlatformAuthError) throw error;
      throw new PlatformAuthError(503, 'auth_unavailable');
    }
  }
  const auth = client.auth;
  return {
    getSession: () => call(auth.getSession()),
    getUser: (token) => call(auth.getUser(token)),
    signInWithPassword: (input) => call(auth.signInWithPassword(input)),
    updateUser: (input) => call(auth.updateUser(input)),
    signInWithOtp: (input) => call(auth.signInWithOtp(input)),
    verifyOtp: (input) => call(auth.verifyOtp(input)),
    signInWithOAuth: (input) => call(auth.signInWithOAuth(input)),
    exchangeCodeForSession: (code) => call(auth.exchangeCodeForSession(code)),
    signOut: (input) => call(auth.signOut(input)),
    mfa: {
      listFactors: () => call(auth.mfa.listFactors()),
      enroll: (input) => call(auth.mfa.enroll(input)),
      unenroll: (input) => call(auth.mfa.unenroll(input)),
      challenge: (input) => call(auth.mfa.challenge(input)),
      verify: (input) => call(auth.mfa.verify(input)),
    },
  };
};
