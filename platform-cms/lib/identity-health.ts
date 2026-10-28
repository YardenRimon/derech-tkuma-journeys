/** Read-only availability of the configured identity dependency, not a login test.
 * Official response contract: supabase/auth internal/api/api.go HealthCheck.
 * https://github.com/supabase/auth/blob/master/internal/api/api.go
 * No SDK session/bootstrap, user JWT, management API, log or request on import.
 */
import { PLATFORM_AUTH_PROJECT_URL } from './platform-auth-core';
export type IdentityHealthConfig = {
  PLATFORM_AUTH_MODE?: unknown;
  PLATFORM_AUTH_SUPABASE_URL?: unknown;
  PLATFORM_AUTH_SUPABASE_PUBLISHABLE_KEY?: unknown;
};
export type IdentityReadiness = { identityReady: boolean; identityState: 'ready' | 'unavailable' | 'not_required' };
type Timer = ReturnType<typeof setTimeout>;
type ProbeOptions = {
  fetchImpl?: typeof fetch; clock?: () => number;
  // Code-owned fixture controls only; no env/request can change these bounds.
  setTimer?: (callback: () => void, milliseconds: number) => Timer;
  clearTimer?: (timer: Timer) => void;
};
const HEALTHY_MS = 60_000, FAILED_MS = 5_000, DEADLINE_MS = 2_500, MAX_BODY = 2_048;
const HEALTH_PATH = '/auth/v1/health';
const ready = (ok: boolean): IdentityReadiness => ({ identityReady: ok, identityState: ok ? 'ready' : 'unavailable' });
function healthyDocument(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const document = value as Record<string, unknown>;
  return Object.keys(document).length === 3 && ['version', 'name', 'description'].every(key => Object.hasOwn(document, key))
    && document.name === 'GoTrue' && document.description === 'GoTrue is a user registration and authentication API'
    && typeof document.version === 'string' && document.version.length <= 80 && !/[\u0000-\u001f\u007f]/.test(document.version);
}

/** One slot per isolate bounds memory and coalesces concurrent health reads.
 * An expired healthy result is never returned while refreshing. Changed keys,
 * invalid config or mode changes invalidate both cache and pending ownership.
 */
export function createIdentityHealthProbe(options: ProbeOptions = {}) {
  type Slot = { key: string; pending?: Promise<IdentityReadiness>; result?: IdentityReadiness; checkedAt: number; expiresAt: number };
  let cache: Slot | undefined;
  const now = options.clock ?? (() => Date.now());
  async function provider(key: string): Promise<boolean> {
    const controller = new AbortController();let timer: Timer | undefined, reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    const schedule = options.setTimer ?? ((callback, milliseconds) => setTimeout(callback, milliseconds));
    const cancelTimer = options.clearTimer ?? (handle => clearTimeout(handle));
    const deadline = new Promise<boolean>(resolve => { timer = schedule(() => { controller.abort();resolve(false); }, DEADLINE_MS); });
    const operation = async () => {
      try {
        // Fetch itself is obtained lazily; importing or using legacy/mock mode
        // cannot even invoke a supplied transport or look up global fetch.
        const fetcher = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
        const address = PLATFORM_AUTH_PROJECT_URL + HEALTH_PATH;
        const response = await fetcher(address, { method: 'GET', redirect: 'manual', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', signal: controller.signal, headers: { accept: 'application/json', apikey: key } });
        if (controller.signal.aborted) { void response.body?.cancel().catch(() => {});return false; }
        if (response.status !== 200 || response.redirected || response.url && response.url !== address || !/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')) { void response.body?.cancel().catch(() => {});return false; }
        const length = response.headers.get('content-length');
        if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_BODY)) { void response.body?.cancel().catch(() => {});return false; }
        reader = response.body?.getReader();if (!reader) return false;
        const chunks: Uint8Array[] = [];let size = 0;
        for (;;) {
          const chunk = await reader.read();if (chunk.done) break;
          size += chunk.value.byteLength;if (size > MAX_BODY) return false;
          chunks.push(chunk.value);
        }
        if (controller.signal.aborted) return false;
        const bytes = new Uint8Array(size);let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset);offset += chunk.byteLength; }
        return healthyDocument(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
      } catch { return false; }
    };
    try { return await Promise.race([operation(), deadline]); }
    finally {
      controller.abort();if (timer !== undefined) cancelTimer(timer);
      if (reader) void reader.cancel().catch(() => {});
    }
  }
  return async function identityHealth(config: IdentityHealthConfig): Promise<IdentityReadiness> {
    if (config.PLATFORM_AUTH_MODE !== 'supabase') { cache = undefined;return { identityReady: true, identityState: 'not_required' }; }
    const key = config.PLATFORM_AUTH_SUPABASE_PUBLISHABLE_KEY;
    if (config.PLATFORM_AUTH_SUPABASE_URL !== PLATFORM_AUTH_PROJECT_URL || typeof key !== 'string' || !/^sb_publishable_[A-Za-z0-9_-]{12,200}$/.test(key)) { cache = undefined;return ready(false); }
    const started = now();if (!Number.isFinite(started) || started < 0) { cache = undefined;return ready(false); }
    if (cache?.key === key) {
      if (cache.pending) return { ...await cache.pending };
      if (cache.result && started >= cache.checkedAt && started < cache.expiresAt) return { ...cache.result };
    }
    const slot: Slot = { key, checkedAt: started, expiresAt: 0 };cache = slot;
    slot.pending = (async () => {
      const ok = await provider(key),completed = now();
      // Late completion under a removed/rotated config cannot restore healthy.
      if (cache !== slot || !Number.isFinite(completed) || completed < started) return ready(false);
      const result = ready(ok);slot.result = result;slot.checkedAt = completed;slot.expiresAt = completed + (ok ? HEALTHY_MS : FAILED_MS);slot.pending = undefined;
      return result;
    })();
    return { ...await slot.pending };
  };
}

export const identityHealth = createIdentityHealthProbe();
