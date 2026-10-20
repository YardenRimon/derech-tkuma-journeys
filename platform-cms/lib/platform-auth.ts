import { env } from 'cloudflare:workers';
import { platformAuthConfig } from './platform-auth-core';
import { createManagedPlatformProvider } from './platform-auth-provider';
import { platformAuthRateLimiter } from './platform-auth-rate';
import { handlePlatformAuth, platformAuthUnavailable, readVerifiedPlatformIdentity } from './platform-auth-service';

export { appendPlatformAuthCookies, PlatformAuthError } from './platform-auth-core';

/** All public routes and the Worker verification boundary use these same
 * request-scoped adapters, fixed managed issuer, and server-only bindings. */
export async function handlePlatformAuthRequest(request: Request): Promise<Response> {
  try {
    const bindings = env as unknown as Record<string, unknown> & { DB?: D1Database };
    return await handlePlatformAuth(request, {
      config: platformAuthConfig(bindings),
      providerFactory: createManagedPlatformProvider,
      limiter: platformAuthRateLimiter(bindings.DB),
    });
  } catch {
    return platformAuthUnavailable();
  }
}

export async function readPlatformAuthIdentity(request: Request, options: { requireAal2?: boolean } = { requireAal2: true }) {
  return readVerifiedPlatformIdentity(request, platformAuthConfig(env as unknown as Record<string, unknown>), createManagedPlatformProvider, options);
}
