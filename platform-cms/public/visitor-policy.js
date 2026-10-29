/** Prepared visitor policy. The installed review runtime has no dispatcher,
 * provider loader, persistence or consent UI. Production verification is an
 * operator attestation, not something this browser module can establish.
 */
export const CONSENT_POLICY_VERSION = '2026-10-20';
export const APPROVED_WHATSAPP = '972535955166';
const origins = new Set(['https://derech-tkuma.com', 'https://www.derech-tkuma.com']);
const sourcePhones = new Set(['535955166', '0535955166', APPROVED_WHATSAPP]);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));
const exactKeys = (value, keys) => plain(value) && Object.keys(value).length === keys.length &&
  keys.every(key => Object.hasOwn(value, key));

export function normalizeWhatsAppHref(href) {
  if (typeof href !== 'string') return href;
  try {
    const url = new URL(href);
    if (url.protocol !== 'https:' || url.hostname !== 'wa.me' || url.port || url.username || url.password) return href;
    const match = /^\/(\d+)\/?$/.exec(url.pathname);
    if (!match || !sourcePhones.has(match[1])) return href;
    // Replace only the proven phone path: keep source query/fragment bytes and CTA text.
    return href.replace(/^(https:\/\/wa\.me\/)\d+(?=\/?(?:[?#]|$))/i, '$1' + APPROVED_WHATSAPP);
  } catch { return href; }
}

function verifiedConfiguration(config, origin) {
  return exactKeys(config, ['verified', 'origin', 'revision', 'strategy', 'ga4Id', 'gtmId', 'metaPixelId']) &&
    config.verified === true && config.origin === origin && origins.has(origin) &&
    typeof config.revision === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(config.revision) &&
    ['gtm', 'ga4-direct'].includes(config.strategy) && config.ga4Id === 'G-DV3E8J77EX' &&
    config.gtmId === 'GTM-5N7NPTL4' && config.metaPixelId === '766863783155971';
}

function safeEvent(name, fields) {
  if (name === 'page_view' && exactKeys(fields, ['pageKind']) &&
      ['home', 'tour', 'routes', 'quote', 'other'].includes(fields.pageKind)) return {name, pageKind:fields.pageKind};
  if (name === 'whatsapp_click' && exactKeys(fields, ['placement']) &&
      ['home', 'tour', 'footer', 'other'].includes(fields.placement)) return {name, placement:fields.placement};
  return null;
}

export function createVisitorPolicy({mode='review', origin='', productionConfiguration=null, dispatch=null}={}) {
  // Snapshot gate values: later mutation of a caller's config cannot enable dispatch.
  const configured = mode === 'production' && verifiedConfiguration(productionConfiguration, origin) && typeof dispatch === 'function';
  const revision = configured ? productionConfiguration.revision : null;
  let analytics = false, marketing = false;
  const status = () => Object.freeze({policyVersion:CONSENT_POLICY_VERSION, analytics, marketing, canDispatch:configured && analytics});
  return Object.freeze({
    status,
    setConsent(value) {
      if (!exactKeys(value, ['policyVersion', 'analytics', 'marketing']) || value.policyVersion !== CONSENT_POLICY_VERSION ||
          typeof value.analytics !== 'boolean' || typeof value.marketing !== 'boolean') return false;
      analytics=value.analytics; marketing=value.marketing; return true;
    },
    revoke() { analytics=false; marketing=false; },
    track(name, fields) {
      const event = safeEvent(name, fields);
      if (!event || !configured || !analytics) return false;
      // Analytics-only contract: marketing consent has no event/dispatch implementation.
      // No free text, path, URL, query, user, contact or payment fields are admitted.
      // No queue or retry survives revoke. This module never loads a provider SDK.
      try { dispatch(Object.freeze({...event, purpose:'analytics', policyVersion:CONSENT_POLICY_VERSION, configurationRevision:revision})); return true; }
      catch { return false; }
    },
  });
}

export function normalizeWhatsAppLinks(root) {
  const links = [...(root.matches?.('a[href]') ? [root] : []), ...root.querySelectorAll('a[href]')];
  for (const link of links) {
    const before=link.getAttribute('href'), after=normalizeWhatsAppHref(before);
    if (after !== before) link.setAttribute('href', after);
  }
}

export function installVisitorPolicy(document, {policy=createVisitorPolicy(), Observer=globalThis.MutationObserver}={}) {
  normalizeWhatsAppLinks(document);
  const click = event => {
    // The existing review guard runs first in capture phase and may stop this listener.
    if (event.defaultPrevented) return;
    const link=event.target?.closest?.('a[href]');
    if (link && normalizeWhatsAppHref(link.getAttribute('href'))?.match(/^https:\/\/wa\.me\/972535955166(?:\/?[?#]|\/?$)/i))
      policy.track('whatsapp_click', {placement:'other'});
  };
  document.addEventListener('click', click, true);
  const observer=Observer ? new Observer(records => {
    for (const record of records) {
      if (record.type === 'attributes') normalizeWhatsAppLinks(record.target);
      else for (const node of record.addedNodes) if (node.nodeType === 1) normalizeWhatsAppLinks(node);
    }
  }) : null;
  observer?.observe(document.documentElement, {subtree:true, childList:true, attributes:true, attributeFilter:['href']});
  return Object.freeze({status:policy.status, setConsent:policy.setConsent, revoke:policy.revoke,
    dispose() { policy.revoke(); observer?.disconnect(); document.removeEventListener('click', click, true); }});
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  // Deliberately fixed review mode. No window flag, URL, storage value or DOM
  // attribute can activate production. A reviewed server integration is still required.
  installVisitorPolicy(document);
}
