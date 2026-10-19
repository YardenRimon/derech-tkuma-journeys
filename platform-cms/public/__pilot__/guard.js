/* Local preview only. Does not replace any visual widget handler. */
(() => {
  'use strict';
  const forbidden = /\/(?:wp-admin|wp-json|cart|checkout)(?:\/|$)|(?:^|[?&])(?:wc-ajax|add-to-cart)=/i;
  const permitted = (value, method = 'GET') => {
    try {
      const url = new URL(value, location.href);
      return /^(GET|HEAD)$/i.test(method) &&
        (url.origin === location.origin || url.protocol === 'data:') &&
        !forbidden.test(url.pathname + url.search);
    } catch { return false; }
  };
  const denied = () => new DOMException('Disabled in the local visual pilot', 'NotAllowedError');
  const originalFetch = window.fetch.bind(window);
  window.fetch = (input, init) => permitted(typeof input === 'string' ? input : input.url,
      init?.method || input?.method || 'GET') ? originalFetch(input, init) : Promise.reject(denied());
  const originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    if (!permitted(url, method)) throw denied();
    return originalOpen.call(this, method, url, ...rest);
  };
  navigator.sendBeacon = () => false;
  const originalWindowOpen = window.open.bind(window);
  window.open = (url, ...rest) => !url || permitted(url) ? originalWindowOpen(url, ...rest) : null;
  HTMLFormElement.prototype.submit = () => { throw denied(); };
  document.addEventListener('submit', event => {
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);
  document.addEventListener('click', event => {
    const link = event.target.closest?.('a[href]');
    if (link && !permitted(link.href)) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, true);
})();
