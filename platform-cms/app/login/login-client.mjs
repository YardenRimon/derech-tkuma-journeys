// The browser receives session state and enrollment data, never provider session tokens.
export function loginClientSource(returnTo) {
  const serialized = JSON.stringify(returnTo).replaceAll('<', '\\u003c').replaceAll('\u2028', '\\u2028').replaceAll('\u2029', '\\u2029');
  return String.raw`(() => {
  'use strict';
  const returnTo = ${serialized};
  const passwordSettings = new URLSearchParams(location.search).get('settings') === 'password';
  const logoutRequested = new URLSearchParams(location.search).get('logout') === '1';
  const byId = id => document.getElementById(id);
  let csrfToken = '', ready = false, busy = false, method = 'password', otpEmail = '', factorId = '', factors = [], resendUntil = 0, focusAfterBusy = '', logoutConfirmed = false, emailOtpAvailable = true, requireMfa = true;
  const messages = {
    auth_unavailable:'שירות ההתחברות אינו זמין כרגע. נסה שוב בעוד כמה דקות.',
    invalid_request:'בדוק את הפרטים שהזנת ונסה שוב.',
    csrf_rejected:'העמוד אינו מעודכן. לחץ על רענון ההתחברות ונסה שוב.',
    credentials_invalid:'לא ניתן להתחבר באמצעות הפרטים האלה. בדוק את כתובת המייל והסיסמה ונסה שוב.',
    method_unavailable:'כניסה בקוד במייל עדיין בהקמה. אפשר להתחבר עם Google או סיסמה.',
    otp_invalid:'הקוד שגוי או שפג תוקפו. בדוק את הקוד האחרון שקיבלת ונסה שוב.',
    mfa_invalid:'קוד האימות שגוי או שפג תוקפו. הזן את הקוד העדכני מהאפליקציה.',
    mfa_required:'יש להשלים את האימות הנוסף כדי להיכנס לניהול.',
    rate_limited:'בוצעו ניסיונות רבים. המתן כמה דקות לפני שתנסה שוב.',
    unauthenticated:'ההתחברות הסתיימה. התחבר מחדש כדי להמשיך.',
    mfa_already_enrolled:'כבר הוגדרה אפליקציית אימות לחשבון. רענן את ההתחברות כדי להמשיך.',
    callback_failed:'ההתחברות עם Google לא הושלמה. נסה שוב.',
    password_update_failed:'לא ניתן לשמור את הסיסמה כרגע. נסה שוב או התחבר מחדש.',
    network:'לא הצלחנו ליצור קשר עם שירות ההתחברות. בדוק את החיבור ונסה שוב.'
  };
  function status(message, tone = 'info') {
    const box = byId('auth-status');
    box.textContent = message;
    box.dataset.tone = tone;
    box.hidden = !message;
    box.setAttribute('role', tone === 'error' ? 'alert' : 'status');
  }
  function setBusy(value) {
    busy = value;
    byId('auth-card').setAttribute('aria-busy', String(value));
    byId('signin-controls').disabled = value || !ready;
    byId('mfa-controls').disabled = value || !ready || !requireMfa;
    byId('password-controls').disabled = value || !ready;
    for (const id of ['retry-session','refresh-session','logout','success-logout','password-logout']) byId(id).disabled = value;
    byId('confirm-logout').disabled = value || !ready || logoutConfirmed;
    updateResend();
    if (!value && focusAfterBusy) { const id = focusAfterBusy; focusAfterBusy = ''; byId(id).focus(); }
  }
  function focusWhenReady(id) { if (busy) focusAfterBusy = id; else byId(id).focus(); }
  async function api(action, payload) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch('/api/auth/' + action, {
        method: payload === undefined ? 'GET' : 'POST',
        credentials:'same-origin', cache:'no-store', redirect:'error', signal:controller.signal,
        headers:payload === undefined ? {accept:'application/json'} : {accept:'application/json','content-type':'application/json','x-platform-auth-csrf':csrfToken},
        ...(payload === undefined ? {} : {body:JSON.stringify(payload)})
      });
      let result;
      try { result = await response.json(); } catch { throw {code:'auth_unavailable'}; }
      if (!response.ok) throw {code:typeof result?.error?.code === 'string' ? result.error.code : 'auth_unavailable',legacyAccessFallback:result?.legacyAccessFallback === true};
      if (!result || typeof result !== 'object' || Array.isArray(result)) throw {code:'auth_unavailable'};
      return result;
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error) throw error;
      throw {code:'network'};
    } finally { clearTimeout(timeout); }
  }
  function showView(view) {
    for (const name of ['signin','mfa','unavailable','success','password','logout']) byId(name + '-view').hidden = name !== view;
    byId('card-title').textContent = {signin:'כניסה לחשבון',mfa:'אימות נוסף',unavailable:'ההתחברות אינה זמינה',success:'הזהות אומתה',password:'הגדרת סיסמה',logout:'התנתקות מהחשבון'}[view];
    byId('card-intro').textContent = {signin:'בחר איך נוח לך להתחבר.',mfa:'עוד שלב אחד לפני הכניסה לסביבת הניהול.',unavailable:'אפשר לנסות שוב בהמשך או לחזור לאתר.',success:'אפשר להמשיך לסביבת הניהול של דרך התקומה.',password:'הוסף או עדכן סיסמה לחשבון שאיתו התחברת.',logout:'לחץ על הכפתור כדי להתנתק מסביבת הניהול.'}[view];
    byId('refresh-session').hidden = true;
  }
  function clearSecrets() {
    byId('password').value = '';
    byId('email-code').value = '';
    byId('mfa-code').value = '';
    byId('new-password').value = '';
    byId('confirm-password').value = '';
    byId('mfa-secret').textContent = '';
    byId('mfa-qr').removeAttribute('src');
    byId('mfa-setup').hidden = true;
    factorId = '';
    factors = [];
  }
  function safeTarget(value) {
    if (typeof value !== 'string' || value.length > 2048 || /[\\\u0000-\u0020\u007f]/.test(value)) return returnTo;
    try {
      const path = decodeURIComponent(value.split(/[?#]/)[0]);
      const parsed = new URL(value, location.origin);
      if (path.includes('//') || path.includes('\\') || /[\u0000-\u0020\u007f]/.test(path) || parsed.origin !== location.origin || !(parsed.pathname === '/admin' || parsed.pathname.startsWith('/admin/'))) return returnTo;
      return parsed.pathname + parsed.search;
    } catch { return returnTo; }
  }
  function setMfaPolicy(policy) {
    requireMfa = policy?.requireMfa !== false;
    byId('mfa-step').hidden = !requireMfa;
    byId('signin-steps').dataset.mfaRequired = String(requireMfa);
  }
  function canEnter(result) {
    return result.authenticated === true && result.mfaRequired === false &&
      (result.identity?.aal === 'aal2' || (!requireMfa && result.identity?.aal === 'aal1'));
  }
  function showSuccess(identity, target, navigate) {
    clearSecrets();
    if (passwordSettings) {
      showView('password');
      byId('password-account').textContent = typeof identity.email === 'string' ? identity.email : '';
      byId('password-continue').href = safeTarget(target);
      status(requireMfa ? 'החשבון אומת באימות נוסף. אפשר להגדיר סיסמה לכניסות הבאות.' : 'החשבון אומת. אפשר להגדיר סיסמה לכניסות הבאות.');
      return;
    }
    showView('success');
    byId('success-account').textContent = typeof identity.email === 'string' ? identity.email : '';
    byId('continue').href = safeTarget(target);
    status('האימות הושלם. הגישה לתוכן נקבעת לפי הרשאות החשבון.');
    if (navigate) location.assign(byId('continue').href);
  }
  function renderMfa(session) {
    clearSecrets();
    showView('mfa');
    const identity = session.identity || {};
    byId('account-name').textContent = typeof identity.displayName === 'string' ? identity.displayName : 'החשבון שלך';
    byId('account-email').textContent = typeof identity.email === 'string' ? identity.email : '';
    factors = Array.isArray(session.factors) ? session.factors.filter(item => item && typeof item.id === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(item.id) && item.status === 'verified') : [];
    const select = byId('mfa-factor');
    select.replaceChildren();
    for (const factor of factors) {
      const option = document.createElement('option');
      option.value = factor.id;
      option.textContent = typeof factor.friendlyName === 'string' ? factor.friendlyName : 'אפליקציית אימות';
      select.append(option);
    }
    factorId = factors[0]?.id || '';
    byId('factor-field').hidden = factors.length < 2;
    byId('mfa-enroll').hidden = !!factorId;
    byId('mfa-verify').hidden = !factorId;
    byId('mfa-instruction').textContent = factorId ? 'פתח את אפליקציית האימות שלך והזן את הקוד שמופיע בה.' : 'כדי להגן על הגישה לניהול, חבר את החשבון לאפליקציית אימות. את ההגדרה עושים פעם אחת.';
    status('');
    if (factorId) focusWhenReady('mfa-code');
  }
  async function loadSession() {
    ready = false;
    focusAfterBusy = '';
    setBusy(true);
    status('בודקים את מצב ההתחברות…','loading');
    try {
      const session = await api('session');
      if (session.configured !== true || typeof session.csrfToken !== 'string' || !/^[a-f0-9]{64}$/.test(session.csrfToken)) throw {code:'auth_unavailable',legacyAccessFallback:session.legacyAccessFallback === true};
      csrfToken = session.csrfToken;
      ready = true;
      setMfaPolicy(session.policy);
      setEmailOtpAvailability(session.methods?.emailOtp !== false);
      if (logoutRequested && !logoutConfirmed) {
        clearSecrets();
        resetOtp();
        if (session.authenticated === true) {
          showView('logout');
          byId('logout-account').textContent = typeof session.identity?.email === 'string' ? session.identity.email : '';
          byId('logout-cancel').href = safeTarget(returnTo);
          status('');
        } else {
          logoutConfirmed = true;
          showView('signin');
          status('החשבון כבר מנותק. אפשר להתחבר כדי להמשיך.');
        }
        return;
      }
      if (session.authenticated === true) {
        if (!['aal1','aal2'].includes(session.identity?.aal)) throw {code:'auth_unavailable'};
        if (canEnter(session)) showSuccess(session.identity, returnTo, !requireMfa && session.identity.aal === 'aal1');
        else if (requireMfa) renderMfa(session);
        else throw {code:'auth_unavailable'};
      } else {
        clearSecrets();
        resetOtp();
        showView('signin');
        status(new URLSearchParams(location.search).has('error') ? messages.callback_failed : '');
      }
    } catch (error) {
      ready = false;
      csrfToken = '';
      clearSecrets();
      showView('unavailable');
      byId('legacy-access').hidden = error?.legacyAccessFallback !== true;
      status(messages[error?.code] || messages.auth_unavailable,'error');
    } finally { setBusy(false); }
  }
  async function run(action) {
    if (busy || !ready) return;
    setBusy(true);
    status('מבצעים את הבקשה…','loading');
    try { await action(); }
    catch (error) {
      if (error?.code === 'method_unavailable') setEmailOtpAvailability(false);
      status(messages[error?.code] || messages.auth_unavailable,'error');
      byId('refresh-session').hidden = !['csrf_rejected','unauthenticated','mfa_already_enrolled'].includes(error?.code);
      if (error?.code === 'mfa_invalid') { byId('mfa-code').value = ''; focusWhenReady('mfa-code'); }
      if (error?.code === 'otp_invalid') { byId('email-code').value = ''; focusWhenReady('email-code'); }
    } finally { setBusy(false); }
  }
  function setEmailOtpAvailability(available) {
    emailOtpAvailable = available;
    byId('tab-otp').disabled = !available;
    byId('tab-otp').setAttribute('aria-disabled',String(!available));
    byId('forgot-password').disabled = !available;
    byId('forgot-password').hidden = !available;
    byId('email-otp-unavailable').hidden = available;
    byId('signin-method-summary').textContent = available ? 'עם Google, סיסמה או קוד חד־פעמי במייל.' : 'עם Google או סיסמה.';
    if (!available && method === 'otp') chooseMethod('password',false,true);
    updateResend();
  }
  function chooseMethod(value, focus = false, refreshing = false) {
    if ((!refreshing && busy) || (value === 'otp' && !emailOtpAvailable)) return;
    if (value === 'password') resetOtp();
    method = value;
    for (const name of ['password','otp']) {
      byId('tab-' + name).setAttribute('aria-selected', String(name === value));
      byId('tab-' + name).tabIndex = name === value ? 0 : -1;
      byId('panel-' + name).hidden = name !== value;
    }
    byId('password').required = value === 'password';
    byId('email-code').required = value === 'otp' && !!otpEmail;
    byId('otp-actions').hidden = value !== 'otp' || !otpEmail;
    byId('signin-submit').textContent = value === 'password' ? 'כניסה עם סיסמה' : otpEmail ? 'אימות הקוד והמשך' : 'שליחת קוד למייל';
    status('');
    if (focus) byId('email').focus();
  }
  function resetOtp() {
    otpEmail = '';
    byId('email').readOnly = false;
    byId('otp-entry').hidden = true;
    byId('otp-actions').hidden = true;
    byId('email-code').value = '';
    byId('email-code').required = false;
    byId('signin-submit').textContent = method === 'password' ? 'כניסה עם סיסמה' : 'שליחת קוד למייל';
  }
  function updateResend() {
    const remaining = Math.max(0, Math.ceil((resendUntil - Date.now()) / 1000));
    byId('resend-otp').disabled = busy || !emailOtpAvailable || remaining > 0;
    byId('resend-otp').textContent = remaining > 0 ? 'שליחה חוזרת בעוד ' + remaining + ' שנ׳' : 'שליחת קוד נוסף';
  }
  async function sendOtp() {
    if (!emailOtpAvailable) throw {code:'method_unavailable'};
    const email = byId('email').value.trim().toLowerCase();
    await api('otp/send', {email,returnTo});
    otpEmail = email;
    resendUntil = Date.now() + 60000;
    byId('email').readOnly = true;
    byId('otp-entry').hidden = false;
    byId('otp-actions').hidden = false;
    byId('email-code').required = true;
    byId('signin-submit').textContent = 'אימות הקוד והמשך';
    status('אם קיים חשבון מורשה לכתובת הזו, נשלח אליו קוד חד־פעמי. הזן את הקוד שקיבלת.');
    focusWhenReady('email-code');
  }
  async function acceptLogin(result) {
    byId('password').value = '';
    byId('email-code').value = '';
    if (result.authenticated !== true || !result.identity) throw {code:'auth_unavailable'};
    if (canEnter(result)) showSuccess(result.identity, result.returnTo, true);
    else await loadSession();
  }
  byId('signin-form').addEventListener('submit', event => {
    event.preventDefault();
    const form = byId('signin-form');
    if (!form.reportValidity()) return;
    if (method === 'otp' && !emailOtpAvailable) { status(messages.method_unavailable,'error'); return; }
    run(async () => {
      if (method === 'password') await acceptLogin(await api('password', {email:byId('email').value.trim(),password:byId('password').value,returnTo}));
      else if (!otpEmail) await sendOtp();
      else await acceptLogin(await api('otp/verify', {email:otpEmail,token:byId('email-code').value.trim(),returnTo}));
    });
  });
  for (const name of ['password','otp']) {
    byId('tab-' + name).addEventListener('click', () => chooseMethod(name));
    byId('tab-' + name).addEventListener('keydown', event => {
      if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
      event.preventDefault();
      const next = !emailOtpAvailable || event.key === 'Home' ? 'password' : event.key === 'End' ? 'otp' : name === 'password' ? 'otp' : 'password';
      chooseMethod(next);
      byId('tab-' + next).focus();
    });
  }
  byId('forgot-password').addEventListener('click', () => { if (!emailOtpAvailable || busy) return; chooseMethod('otp',true); status('אפשר להתחבר עם קוד חד־פעמי במייל, בלי לשנות את הסיסמה.'); });
  byId('toggle-password').addEventListener('click', () => {
    const show = byId('password').type === 'password';
    byId('password').type = show ? 'text' : 'password';
    byId('toggle-password').textContent = show ? 'הסתר' : 'הצג';
    byId('toggle-password').setAttribute('aria-pressed',String(show));
    byId('toggle-password').setAttribute('aria-label',show ? 'הסתרת הסיסמה' : 'הצגת הסיסמה');
  });
  byId('change-email').addEventListener('click', () => { resetOtp(); status(''); byId('email').focus(); });
  byId('resend-otp').addEventListener('click', () => { if (emailOtpAvailable && Date.now() >= resendUntil) run(sendOtp); });
  byId('google-login').addEventListener('click', () => run(async () => {
    const result = await api('oauth/google', {returnTo});
    let destination;
    try { destination = new URL(result.redirectUrl); } catch { throw {code:'auth_unavailable'}; }
    if (!/^https:\/\/[a-z0-9]{20}\.supabase\.co$/.test(destination.origin) || destination.pathname !== '/auth/v1/authorize' || destination.searchParams.get('provider') !== 'google' || destination.username || destination.password) throw {code:'auth_unavailable'};
    status('ממשיכים להתחברות עם Google…','loading');
    location.assign(destination.href);
  }));
  byId('mfa-factor').addEventListener('change', () => { factorId = byId('mfa-factor').value; byId('mfa-code').value = ''; });
  byId('mfa-enroll').addEventListener('click', () => { if (!requireMfa) return; run(async () => {
    const result = await api('mfa/enroll', {});
    if (typeof result.factorId !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(result.factorId) || typeof result.qrCode !== 'string' || result.qrCode.length > 60000 || !/^data:image\/svg\+xml(?:;base64)?,/.test(result.qrCode) || typeof result.secret !== 'string' || !/^[A-Z2-7]{8,200}$/i.test(result.secret)) throw {code:'auth_unavailable'};
    factorId = result.factorId;
    byId('mfa-qr').src = result.qrCode;
    byId('mfa-secret').textContent = result.secret;
    byId('mfa-setup').hidden = false;
    byId('mfa-enroll').hidden = true;
    byId('mfa-verify').hidden = false;
    byId('mfa-instruction').textContent = 'סרוק את הקוד באפליקציית אימות, ואז הזן כאן את הקוד בן 6 הספרות שמופיע בה.';
    status('ההגדרה תושלם רק לאחר אימות הקוד מהאפליקציה.');
    focusWhenReady('mfa-code');
  }); });
  byId('copy-secret').addEventListener('click', async () => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error();
      await navigator.clipboard.writeText(byId('mfa-secret').textContent);
      status('מפתח ההגדרה הועתק. שמור אותו רק באפליקציית האימות שלך.');
    } catch { status('לא ניתן להעתיק אוטומטית. אפשר לסמן ולהעתיק את מפתח ההגדרה שמופיע במסך.'); }
  });
  byId('mfa-form').addEventListener('submit', event => {
    event.preventDefault();
    if (!requireMfa || !byId('mfa-form').reportValidity()) return;
    run(async () => {
      if (!factorId) throw {code:'invalid_request'};
      const challenge = await api('mfa/challenge', {factorId});
      const result = await api('mfa/verify', {factorId,challengeId:challenge.challengeId,code:byId('mfa-code').value.trim(),returnTo});
      if (result.authenticated !== true || result.identity?.aal !== 'aal2' || result.mfaRequired !== false) throw {code:'mfa_required'};
      showSuccess(result.identity,result.returnTo,true);
    });
  });
  async function logout() {
    const result = await api('logout', {});
    if (result.signedOut !== true) throw {code:'auth_unavailable'};
    logoutConfirmed = true;
    clearSecrets();
    resetOtp();
    byId('email').value = '';
    await loadSession();
    status('התנתקת מהחשבון. אפשר להתחבר עם חשבון אחר.');
  }
  byId('password-set-form').addEventListener('submit', event => {
    event.preventDefault();
    const confirmation = byId('confirm-password');
    confirmation.setCustomValidity(confirmation.value === byId('new-password').value ? '' : 'הסיסמאות אינן זהות. הזן שוב את אותה סיסמה.');
    if (!byId('password-set-form').reportValidity()) return;
    run(async () => {
      let result;
      try { result = await api('password/set', {password:byId('new-password').value}); }
      finally { byId('new-password').value = ''; confirmation.value = ''; }
      if (result.passwordUpdated !== true) throw {code:'password_update_failed'};
      status('הסיסמה נשמרה. בכניסה הבאה אפשר להשתמש במייל ובסיסמה החדשה.');
      focusWhenReady('password-continue');
    });
  });
  for (const id of ['new-password','confirm-password']) byId(id).addEventListener('input', () => byId('confirm-password').setCustomValidity(''));
  for (const id of ['logout','success-logout','password-logout']) byId(id).addEventListener('click', () => run(logout));
  byId('confirm-logout').addEventListener('click', () => { if (!logoutConfirmed) run(logout); });
  for (const id of ['retry-session','refresh-session']) byId(id).addEventListener('click', () => { if (!busy) loadSession(); });
  // Keep setup secrets in this page only, and remove them from the back/forward cache.
  addEventListener('pagehide',clearSecrets);
  addEventListener('pageshow',event => { if (event.persisted) loadSession(); });
  setInterval(updateResend,1000);
  byId('password-settings-link').href = '/login/?settings=password&next=' + encodeURIComponent(returnTo);
  loadSession();
})();`;
}
