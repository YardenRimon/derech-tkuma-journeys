/** Only this external Worker boundary may create these internal identity headers. */
export const identityHeaderPrefix = 'x-platform-authenticated-';
export function stripIdentityHeaders(request: Request): Request {
  const headers = new Headers(request.headers);
  for (const key of [...headers.keys()]) {
    if (key.startsWith('oai-authenticated-user-') || key.startsWith(identityHeaderPrefix)) headers.delete(key);
  }
  return new Request(request, { headers });
}
export function isCmsBrowserPath(pathname: string): boolean {
  return /^\/admin(?:\/|$)/.test(pathname) || /^\/api\/(?:cms|users|collections|tasks|reports|execution)(?:\/|$)/.test(pathname) || /^\/api\/(?:contact|submissions)\/manage\/?$/.test(pathname);
}
type VerifiedIdentity = { userId: string; email: string; displayName: string; fullName: string | null; aal: 'aal1' | 'aal2' };
type AuthResult = { identity: VerifiedIdentity; cookiesToSet: string[] };
type AuthFailure = { status?: number; code?: string; cookiesToSet?: string[] };
export async function platformAuthBoundary(request: Request, verify: (request: Request) => Promise<AuthResult>, policy: { requireMfa?: boolean } = {}): Promise<{ request: Request; response?: Response; cookiesToSet: string[] }> {
  const url = new URL(request.url);
  if (!isCmsBrowserPath(url.pathname)) return { request, cookiesToSet: [] };
  try {
    const { identity, cookiesToSet } = await verify(request);
    if (identity.aal !== 'aal1' && identity.aal !== 'aal2') throw { status: 401, code: 'unauthenticated', cookiesToSet };
    if (policy.requireMfa !== false && identity.aal !== 'aal2') throw { status: 403, code: 'mfa_required', cookiesToSet };
    const headers = new Headers(request.headers);
    headers.set(identityHeaderPrefix + 'id', identity.userId);
    headers.set(identityHeaderPrefix + 'email', identity.email);
    headers.set(identityHeaderPrefix + 'name', encodeURIComponent(identity.fullName ?? identity.displayName));
    headers.set(identityHeaderPrefix + 'aal', identity.aal);
    return { request: new Request(request, { headers }), cookiesToSet };
  } catch (error) {
    const failure = error as AuthFailure;
    const unavailable = failure.status !== 401 && failure.status !== 403;
    const status = unavailable ? 503 : failure.status!;
    const mfa = failure.code === 'mfa_required';
    const response = url.pathname.startsWith('/admin') && !unavailable
      ? new Response(null, { status: 302, headers: { location: '/login/?next=' + encodeURIComponent(url.pathname + url.search) + (mfa ? '&mfa=required' : '') } })
      : Response.json({ error: unavailable ? 'שירות ההתחברות אינו זמין כרגע' : mfa ? 'יש להשלים אימות נוסף' : 'יש להתחבר למערכת', code: unavailable ? 'auth_unavailable' : mfa ? 'mfa_required' : 'unauthenticated' }, { status });
    response.headers.set('cache-control', 'private, no-store');
    return { request, response, cookiesToSet: failure.cookiesToSet ?? [] };
  }
}
