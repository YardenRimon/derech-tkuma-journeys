import { createServerClient } from '@supabase/ssr';
import { AUTH_COOKIE, PlatformAuthError } from './platform-auth-core';
import type { PlatformProviderFactory } from './platform-auth-core';

type AuthOperation = 'user_lookup' | 'session_refresh' | 'other_auth';
function reportProviderFailure(operation: AuthOperation, kind: 'timeout' | 'network' | 'http', attempt: 1 | 2, status?: number) {
  // Construct a closed record. Raw exceptions and request/response material
  // (including URLs, identity, credentials and tokens) never reach a logger.
  try { console.warn({ event: 'platform_auth_provider_failure', operation, kind, attempt, ...(status === undefined ? {} : { status }) }); } catch { /* Diagnostics cannot affect authentication. */ }
}

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
        if (target.origin !== config.url || target.username || target.password || target.hash || !target.pathname.startsWith('/auth/v1/')) {
          throw new PlatformAuthError(503, 'auth_unavailable');
        }
        const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
        const userLookup = method === 'GET' && target.pathname === '/auth/v1/user' && !target.search;
        const operation: AuthOperation = userLookup ? 'user_lookup' : method === 'POST' && target.pathname === '/auth/v1/token' && target.searchParams.get('grant_type') === 'refresh_token' ? 'session_refresh' : 'other_auth';
        // Never forward this request's cookies, headers, or origin to a second
        // host through an upstream redirect. Supabase receives its own SDK data.
        // Only the exact read-only identity lookup gets one transport retry.
        // Both attempts use the same token and fresh remote data; HTTP errors,
        // redirects and every mutation/refresh remain single-attempt.
        for (const attempt of [1, 2] as const) {
          const signal = AbortSignal.timeout(attempt === 1 ? 10000 : 2500);
          try {
            const response = await fetch(input, { ...init, cache: 'no-store', redirect: 'manual', signal });
            if (response.status < 200 || response.status >= 300) reportProviderFailure(operation, 'http', attempt, response.status);
            return response;
          } catch (error) {
            const timeout = signal.aborted || (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError'));
            reportProviderFailure(operation, timeout ? 'timeout' : 'network', attempt);
            if (!userLookup || attempt === 2) throw new PlatformAuthError(503, 'auth_unavailable');
          }
        }
        throw new PlatformAuthError(503, 'auth_unavailable');
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
