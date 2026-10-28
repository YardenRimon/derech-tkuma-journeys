import { CONTACT_POLICY, contactEnabled, type ContactConfig } from './contact-core';

/** Serialized as an early classic script only after the server production gate.
 * Its private fetch reference is captured before the retained review guard.
 * A window capture handler intercepts only the three verified source form identities;
 * Elementor and the document guard cannot also submit that same event. */
function nativeContactClient() {
  if (!['https://derech-tkuma.com', 'https://www.derech-tkuma.com'].includes(location.origin)) return;
  const nativeFetch = window.fetch.bind(window), allowed: Record<string, string> = { '0899899': '13', af355f0: '18', '1b8a2d8': '1489' };
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const attempts = new WeakMap<HTMLFormElement, { key: string; busy: boolean; accepted: boolean }>();
  const field = (form: HTMLFormElement, name: string) => form.elements.namedItem(name) as HTMLInputElement | null;
  function message(form: HTMLFormElement, text: string, error = false) {
    let box = form.querySelector<HTMLElement>('[data-native-contact-status]');
    if (!box) { box = document.createElement('div');box.setAttribute('data-native-contact-status', '');box.setAttribute('aria-live', 'polite');form.appendChild(box); }
    box.className = 'elementor-message elementor-message-' + (error ? 'danger' : 'success');box.setAttribute('role', error ? 'alert' : 'status');box.textContent = text;
  }
  function storage(formId: string, value?: string | null): string | null {
    try { const key = 'derech-contact:v1:' + formId;if (value === null) window.sessionStorage.removeItem(key);else if (value !== undefined) window.sessionStorage.setItem(key, value);return window.sessionStorage.getItem(key); } catch { return null; }
  }
  async function submit(form: HTMLFormElement, formId: string) {
    let attempt = attempts.get(form);
    if (attempt?.busy || attempt?.accepted || !form.reportValidity()) return;
    if (!attempt) {
      const saved = storage(formId);let key: string;
      try { key = saved && uuid.test(saved) ? saved : crypto.randomUUID(); } catch { message(form, 'לא ניתן להכין את הפנייה כרגע. נסה שוב מאוחר יותר.', true);return; }
      if (!uuid.test(key)) { message(form, 'לא ניתן להכין את הפנייה כרגע. נסה שוב מאוחר יותר.', true);return; }
      attempt = { key, busy: false, accepted: false };attempts.set(form, attempt);storage(formId, key);
    }
    const payload = { idempotencyKey: attempt.key, formId, fullName: field(form, 'form_fields[fullname]')?.value ?? '', phone: field(form, 'form_fields[phone]')?.value ?? '', email: field(form, 'form_fields[email]')?.value ?? '', ...(formId === '1b8a2d8' ? { message: field(form, 'form_fields[message]')?.value ?? '' } : {}), consent: { contact: field(form, 'form_fields[field_1704896]')?.checked === true, policyVersion: 'source-2026-10-19' }, honeypot: field(form, 'contact_website')?.value ?? '' };
    const controls = [...form.querySelectorAll<HTMLButtonElement | HTMLInputElement>('button[type="submit"],input[type="submit"]')], disabled = controls.map(control => control.disabled);
    attempt.busy = true;controls.forEach(control => { control.disabled = true; });form.setAttribute('aria-busy', 'true');
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await nativeFetch('/api/contact/', { method: 'POST', credentials: 'same-origin', redirect: 'error', cache: 'no-store', signal: controller.signal, headers: { accept: 'application/json', 'content-type': 'application/json' }, body: JSON.stringify(payload) });
      let result: { accepted?: boolean; receipt?: string; state?: string; code?: string };
      try { result = await response.json(); } catch { throw new Error('unknown_result'); }
      if (response.status === 202 && result?.accepted === true && result.state === 'stored_pending_processing' && typeof result.receipt === 'string' && uuid.test(result.receipt)) {
        attempt.accepted = true;storage(formId, null);message(form, 'הפרטים נשמרו וממתינים לעיבוד. אסמכתה: ' + result.receipt);return;
      }
      if (response.status === 409 && result?.code === 'idempotency_conflict') message(form, 'הפרטים השתנו לאחר ניסיון קודם, שייתכן שכבר נשמר. חזור לפרטים הקודמים ונסה שוב; לא נוצר ניסיון חדש.', true);
      else if (response.status === 400 && ['consent_required', 'invalid_submission', 'invalid_idempotency_key'].includes(result?.code ?? '')) message(form, 'בדוק את הפרטים ואת האישור ליצירת קשר ונסה שוב.', true);
      else message(form, 'לא ניתן להשלים את השמירה כרגע. נסה שוב עם אותם פרטים.', true);
    } catch {
      // A timeout is not proof of rejection. Retain the same UUID, including
      // across a reload when session storage is available; never auto-resend.
      message(form, 'לא ניתן לוודא אם הפרטים נשמרו. נסה שוב בלי לשנות אותם; אותו ניסיון לא ייצור פנייה נוספת.', true);
    } finally {
      clearTimeout(timer);attempt.busy = false;form.setAttribute('aria-busy', 'false');controls.forEach((control, index) => { control.disabled = attempt!.accepted || disabled[index]; });
    }
  }
  window.addEventListener('submit', event => {
    const form = event.target as HTMLFormElement | null;
    if (!form?.matches?.('form.elementor-form')) return;
    const formId = field(form, 'form_id')?.value ?? '';
    if (!Object.hasOwn(allowed, formId) || field(form, 'post_id')?.value !== allowed[formId]) return;
    event.preventDefault();event.stopImmediatePropagation();void submit(form, formId);
  }, true);
  const traps = () => {
    for (const form of document.querySelectorAll<HTMLFormElement>('form.elementor-form')) {
      const id = field(form, 'form_id')?.value ?? '';
      if (!Object.hasOwn(allowed, id) || field(form, 'post_id')?.value !== allowed[id] || field(form, 'contact_website')) continue;
      const trap = document.createElement('input');trap.name = 'contact_website';trap.type = 'text';trap.hidden = true;trap.tabIndex = -1;trap.autocomplete = 'off';trap.setAttribute('aria-hidden', 'true');form.appendChild(trap);
    }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', traps, { once: true });else traps();
}

export function contactClientSource(): string { return '(' + nativeContactClient.toString() + ')();'; }

/** Browser flags, Origin/Host headers, or a review-mode typo cannot enable this.
 * The exact request URL origin and existing deployment gate must both pass. */
export function preparePublicContacts(html: string, requestUrl: URL, config: ContactConfig): string {
  try { contactEnabled(config, requestUrl.origin); } catch { return html; }
  if (html.includes('data-native-contact=')) return html;
  // The verified footer widget is repeated across the source pages. The client
  // still checks the exact form/post pair before interception.
  if (!['0899899', 'af355f0', '1b8a2d8'].some(id => html.includes('value="' + id + '"'))) return html;
  // The entire source DOM, copy and original script order remain byte-identical
  // after removing this one insertion. Unknown/rating/quote forms still
  // reach the retained blocking guard and have no native intake handler.
  const script = '<script data-native-contact="' + CONTACT_POLICY + '">' + contactClientSource() + '</script>';
  return html.replace(/<head(?:\s[^>]*)?>/i, head => head + script);
}
