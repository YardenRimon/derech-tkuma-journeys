(() => {
  if (window.parent === window) return;
  const style = document.createElement("style");
  style.textContent = `
    html:not(.cms-editor-preview) [data-edit-id], html:not(.cms-editor-preview) [data-image-id] { cursor: pointer !important; }
    html:not(.cms-editor-preview) [data-edit-id]:hover, html:not(.cms-editor-preview) [data-image-id]:hover { outline: 2px dashed #0b86ad !important; outline-offset: 3px !important; }
    html:not(.cms-editor-preview) .cms-selected { outline: 3px solid #057ea7 !important; outline-offset: 4px !important; }
    html:not(.cms-editor-preview) [data-section-id]:hover { box-shadow: inset 0 0 0 1px rgba(5,126,167,.28); }
    html.cms-editor-preview .cms-selected { outline: none !important; }
  `;
  document.head.append(style);
  let base = null;
  let draft = null;
  let selected = null;
  let preview = false;
  let baseDocument = null;
  let appliedIds = new Set();

  function matching(attribute, id) {
    return [...document.querySelectorAll(`[${attribute}]`)].filter((element) => element.getAttribute(attribute) === id);
  }
  function applyField(id, edit) {
    const definition = base?.fields[id];
    if (!definition) return;
    const current = edit || definition;
    if (definition.type === "text") {
      for (const element of matching("data-edit-id", id)) {
        if (!edit && baseDocument) {
          const original = [...baseDocument.querySelectorAll("[data-edit-id]")].find((item) => item.getAttribute("data-edit-id") === id);
          if (original) { element.innerHTML = original.innerHTML; continue; }
        }
        if (current.english?.trim()) {
          const source = document.createElement("span");
          source.className = "gt-src";
          source.textContent = current.value;
          const english = document.createElement("span");
          english.className = "gt-alt";
          english.setAttribute("translate", "no");
          english.textContent = current.english;
          element.replaceChildren(source, english);
        } else {
          element.textContent = current.value;
        }
      }
    } else {
      for (const element of matching("data-image-id", id)) {
        element.setAttribute("src", current.value);
        if (current.value !== definition.value) { element.removeAttribute("srcset"); element.removeAttribute("sizes"); element.removeAttribute("data-src"); element.removeAttribute("data-srcset"); }
        if (current.alt !== undefined) element.setAttribute("alt", current.alt);
      }
    }
  }
  function applyOrder(order) {
    const main = document.querySelector("main#main") || document.querySelector("main");
    if (!main) return;
    for (const id of order) {
      const section = matching("data-section-id", id)[0];
      if (section && section.parentElement === main) main.append(section);
    }
  }
  function applySeo(seo) {
    document.title = seo?.title || baseDocument?.title || base?.title || document.title;
    const description = seo?.description ?? baseDocument?.head.querySelector('meta[name="description"]')?.getAttribute("content") ?? base?.description;
    if (description !== undefined) {
      const meta = document.head.querySelector('meta[name="description"]');
      if (meta) meta.setAttribute("content", description);
    }
    const ogTitle = document.head.querySelector('meta[property="og:title"]');
    if (ogTitle) ogTitle.setAttribute("content", seo?.title || baseDocument?.head.querySelector('meta[property="og:title"]')?.getAttribute("content") || base?.title || "");
    const ogDescription = document.head.querySelector('meta[property="og:description"]');
    if (ogDescription && description !== undefined) ogDescription.setAttribute("content", description);
  }
  function applySelection(id) {
    document.querySelectorAll(".cms-selected").forEach((element) => element.classList.remove("cms-selected"));
    selected = id;
    if (!id || preview) return;
    for (const attribute of ["data-edit-id", "data-image-id"]) matching(attribute, id).forEach((element) => element.classList.add("cms-selected"));
  }
  function setMode(isPreview) {
    preview = !!isPreview;
    document.documentElement.classList.toggle("cms-editor-preview", preview);
    applySelection(selected);
  }
  window.addEventListener("message", (event) => {
    if (event.origin !== location.origin || event.source !== window.parent || !event.data || typeof event.data !== "object") return;
    const message = event.data;
    if (message.type === "cms:init") {
      base = message.base;
      draft = message.draft;
      if (!base || !draft) return;
      baseDocument = new DOMParser().parseFromString(base.shellPrefix + base.sections.map((section) => section.html).join("") + base.shellSuffix, "text/html");
      const nextIds = new Set(Object.keys(draft.fields || {}));
      for (const id of appliedIds) if (!nextIds.has(id)) applyField(id, null);
      for (const id of nextIds) applyField(id, draft.fields[id]);
      appliedIds = nextIds;
      applyOrder(draft.order || []);
      applySeo(draft.seo);
      setMode(message.preview);
      applySelection(message.selected);
    }
    if (message.type === "cms:field" && base?.fields[message.id]) { applyField(message.id, message.field); appliedIds.add(message.id); }
    if (message.type === "cms:order" && Array.isArray(message.order)) applyOrder(message.order);
    if (message.type === "cms:seo") applySeo(message.seo);
    if (message.type === "cms:mode") setMode(message.preview);
  });
  document.addEventListener("click", (event) => {
    if (!base) return;
    const target = event.target instanceof Element ? event.target : null;
    if (preview) {
      if (target?.closest("a, form")) event.preventDefault();
      return;
    }
    const editable = target?.closest("[data-edit-id], [data-image-id]");
    const link = target?.closest("a, button, input, select, textarea, form");
    if (editable) {
      const id = editable.getAttribute("data-edit-id") || editable.getAttribute("data-image-id");
      if (id && base.fields[id]) {
        event.preventDefault();
        event.stopPropagation();
        applySelection(id);
        window.parent.postMessage({ type: "cms:select", id }, location.origin);
        return;
      }
    }
    if (link) { event.preventDefault(); event.stopPropagation(); }
  }, true);
  document.addEventListener("submit", (event) => event.preventDefault(), true);
  window.parent.postMessage({ type: "cms:ready" }, location.origin);
})();
