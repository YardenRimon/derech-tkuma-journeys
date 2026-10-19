(() => {
  const $ = (selector) => document.querySelector(selector);
  const picker = $("#page-picker");
  const frame = $("#editor-frame");
  const panel = $("#panel-content");
  const status = $("#admin-status");
  const buttons = { save: $("#save"), preview: $("#preview"), publish: $("#publish"), restore: $("#restore") };
  const state = { slug: "/", base: null, draft: null, revision: 0, publishedVersion: 0, dirty: false, busy: false, preview: false, tab: "field", selected: null, canPublish: $("#admin-app").dataset.canPublish === "true" };
  buttons.publish.hidden = !state.canPublish;

  function say(message, isError = false) {
    status.textContent = message;
    status.classList.toggle("is-error", isError);
  }
  function busy(value) {
    state.busy = value;
    picker.disabled = value;
    buttons.save.disabled = value;
    buttons.publish.disabled = value || !state.canPublish;
    buttons.restore.disabled = value;
  }
  async function api(path, options = {}) {
    const response = await fetch(`/api/cms/${path}`, { credentials: "same-origin", cache: "no-store", ...options });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.error || "הפעולה נכשלה");
      error.status = response.status;
      throw error;
    }
    return data;
  }
  function send(message) {
    if (frame.contentWindow) frame.contentWindow.postMessage(message, location.origin);
  }
  function syncFrame() {
    if (!state.base || !state.draft) return;
    send({ type: "cms:init", base: state.base, draft: state.draft, selected: state.selected, preview: state.preview });
  }
  function markDirty() {
    state.dirty = true;
    say("יש שינויים שלא נשמרו");
  }
  function entry(id) {
    return state.draft.fields[id] || { value: state.base.fields[id].value, alt: state.base.fields[id].alt || "" };
  }
  function changeField(id, patch) {
    state.draft.fields[id] = { ...entry(id), ...patch };
    markDirty();
    send({ type: "cms:field", id, field: state.draft.fields[id] });
  }
  function node(tag, className, content) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (content !== undefined) element.textContent = content;
    return element;
  }
  function field(label, control, hint) {
    const wrapper = node("label", "admin-field");
    wrapper.append(node("span", "admin-label", label), control);
    if (hint) wrapper.append(node("small", "admin-hint", hint));
    return wrapper;
  }
  function title(text, detail) {
    const heading = node("h2", null, text);
    panel.append(heading);
    if (detail) panel.append(node("p", "admin-detail", detail));
  }
  function selectTab(name) {
    state.tab = name;
    document.querySelectorAll(".admin-tabs [data-tab]").forEach((button) => button.setAttribute("aria-selected", String(button.dataset.tab === name)));
    renderPanel();
  }
  function renderPanel() {
    panel.replaceChildren();
    if (!state.base || !state.draft) { title("טוען עמוד…"); return; }
    if (state.tab === "field") return renderField();
    if (state.tab === "sections") return renderSections();
    if (state.tab === "seo") return renderSeo();
    if (state.tab === "history") return renderHistory();
  }
  function renderField() {
    const id = state.selected;
    if (!id || !state.base.fields[id]) {
      title("בחר תוכן בעמוד", "לחץ על טקסט או תמונה בתצוגת האתר כדי לערוך אותם כאן.");
      panel.append(node("p", "admin-tip", "השינויים נראים מיד בתצוגה. שמור טיוטה לפני פרסום."));
      return;
    }
    const definition = state.base.fields[id];
    if(state.managedFields?.[id]){
      const managed=state.managedFields[id];
      const note=document.createElement('p');note.textContent='השדה מנוהל עם נתוני הסיור והמועד: '+managed.label;
      const link=document.createElement('a');link.href='/admin/collections?kind='+encodeURIComponent(managed.kind)+'&id='+encodeURIComponent(managed.id);link.textContent='עריכת הסיור או המועד';
      panel.append(note,link);return;
    }
    const current = entry(id);
    const detail = definition.type === "text"
      ? current.value.replace(/\s+/g, " ").trim().slice(0, 70) || "הטקסט שנבחר"
      : (current.alt || "התמונה שנבחרה").trim().slice(0, 70);
    title(definition.type === "text" ? "עריכת טקסט" : "עריכת תמונה", detail);
    if (definition.type === "text") {
      const hebrew = node("textarea");
      hebrew.rows = 6;
      hebrew.maxLength = 10000;
      hebrew.value = current.value;
      hebrew.addEventListener("input", () => changeField(id, { value: hebrew.value }));
      panel.append(field("טקסט בעברית", hebrew, "טקסט רגיל בלבד. עיצוב ותגיות נשמרים בתבנית האתר."));
      const english = node("textarea");
      english.rows = 6;
      english.maxLength = 10000;
      english.value = current.english || "";
      english.addEventListener("input", () => changeField(id, { english: english.value }));
      panel.append(field("תיקון אנגלי ידני", english, "ריק = תרגום האתר הרגיל. טקסט שמוזן כאן יוצג באנגלית במקום התרגום האוטומטי."));
    } else {
      const preview = node("img", "admin-image-preview");
      preview.src = current.value;
      preview.alt = current.alt || "תצוגת תמונה";
      panel.append(preview);
      const alt = node("input");
      alt.type = "text";
      alt.maxLength = 500;
      alt.value = current.alt || "";
      alt.addEventListener("input", () => changeField(id, { alt: alt.value }));
      panel.append(field("תיאור תמונה (alt)", alt, "תאר את התמונה למי שאינו רואה אותה; תמונה דקורטיבית יכולה להישאר ללא תיאור."));
      const file = node("input");
      file.type = "file";
      file.accept = "image/png,image/jpeg,image/webp";
      file.addEventListener("change", async () => {
        const image = file.files && file.files[0];
        if (!image) return;
        if (image.size > 5 * 1024 * 1024) { say("התמונה גדולה מ־5MB", true); return; }
        try {
          say("מעלה תמונה…");
          const result = await api("upload", { method: "POST", headers: { "content-type": image.type }, body: image });
          changeField(id, { value: result.url });
          renderFieldAfterUpload();
          say("התמונה הועלתה לטיוטה. שמור כדי לשמור את הבחירה.");
        } catch (error) { report(error); }
      });
      panel.append(field("העלאת תמונה חדשה", file, "PNG, JPEG או WebP עד 5MB"));
      const original = node("select");
      const assets = [...new Set(Object.values(state.base.fields).filter((item) => item.type === "image" ).map((item) => item.value))].sort();
      original.append(new Option("בחירת תמונה קיימת…", ""));
      for (const path of assets) original.append(new Option(path.split("/").at(-1), path));
      original.value = current.value.startsWith("/assets/") ? current.value : "";
      original.addEventListener("change", () => { if (original.value) { changeField(id, { value: original.value }); preview.src = original.value; } });
      panel.append(field("תמונה קיימת באתר", original));
    }
    const reset = node("button", "admin-reset", "חזרה לערך המקורי");
    reset.type = "button";
    reset.addEventListener("click", () => {
      delete state.draft.fields[id];
      markDirty();
      syncFrame();
      renderPanel();
    });
    panel.append(reset);
  }
  function renderFieldAfterUpload() { renderPanel(); syncFrame(); }
  function sectionName(section) {
    const doc = new DOMParser().parseFromString(section.html, "text/html");
    return doc.querySelector("h1,h2,h3")?.textContent?.trim().slice(0, 55) || section.id;
  }
  function renderSections() {
    title("סדר המקטעים", "אפשר להזיז מקטעים שלמים למעלה או למטה. כל התוכן שבתוכם נשאר יחד.");
    const list = node("ol", "admin-sections");
    state.draft.order.forEach((id, index) => {
      const section = state.base.sections.find((item) => item.id === id);
      const item = node("li");
      item.append(node("span", null, section ? sectionName(section) : id));
      for (const [label, change, description] of [["↑", -1, "העבר למעלה"], ["↓", 1, "העבר למטה"]]) {
        const button = node("button", null, label);
        button.type = "button";
        button.title = description;
        button.setAttribute("aria-label", `${description}: ${section ? sectionName(section) : id}`);
        button.disabled = index + change < 0 || index + change >= state.draft.order.length;
        button.addEventListener("click", () => {
          const next = index + change;
          [state.draft.order[index], state.draft.order[next]] = [state.draft.order[next], state.draft.order[index]];
          markDirty();
          send({ type: "cms:order", order: state.draft.order });
          renderPanel();
        });
        item.append(button);
      }
      list.append(item);
    });
    panel.append(list);
  }
  function renderSeo() {
    title("כותרת ותיאור לחיפוש", "השדות האלה מופיעים בתוצאות חיפוש ובשיתוף קישורים.");
    const seo = state.draft.seo || { title: state.base.title, description: state.base.description || "" };
    const heading = node("input");
    heading.type = "text";
    heading.maxLength = 120;
    heading.value = seo.title;
    const description = node("textarea");
    description.rows = 5;
    description.maxLength = 320;
    description.value = seo.description;
    const update = () => {
      state.draft.seo = { title: heading.value, description: description.value };
      markDirty();
      send({ type: "cms:seo", seo: state.draft.seo });
    };
    heading.addEventListener("input", update);
    description.addEventListener("input", update);
    panel.append(field("כותרת העמוד", heading, "עד 120 תווים"), field("תיאור העמוד", description, "עד 320 תווים"));
    const reset = node("button", "admin-reset", "חזרה לברירת המחדל");
    reset.type = "button";
    reset.addEventListener("click", () => { delete state.draft.seo; markDirty(); syncFrame(); renderPanel(); });
    panel.append(reset);
  }
  async function renderHistory() {
    title("גרסאות שפורסמו", "שחזור יחליף את הטיוטה ואת הגרסה שמוצגת לציבור.");
    const list = node("div", "admin-history", "טוען גרסאות…");
    panel.append(list);
    const loadedSlug = state.slug;
    try {
      const result = await api(`history?slug=${encodeURIComponent(loadedSlug)}`);
      if (state.tab !== "history" || state.slug !== loadedSlug) return;
      if (result.permissions) state.canPublish = result.permissions.canPublish;
      list.replaceChildren();
      if (!result.versions.length) { list.textContent = "אין גרסאות שפורסמו עדיין."; return; }
      for (const version of result.versions) {
        const row = node("div", "admin-history-row");
        const date = new Date(version.publishedAt);
        row.append(node("span", null, `גרסה ${version.version} · ${Number.isNaN(date.valueOf()) ? "" : date.toLocaleString("he-IL")}`));
        const restore = node("button", null, "שחזור");
        restore.type = "button";
        restore.addEventListener("click", async () => {
          if (!confirm(`לשחזר את גרסה ${version.version}? הטיוטה הנוכחית תוחלף.`)) return;
          busy(true);
          try {
            await api("rollback", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ slug: state.slug, version: Number(version.version), revision: state.revision }) });
            await loadPage(state.slug);
            selectTab("history");
            say(`גרסה ${version.version} שוחזרה ופורסמה.`);
          } catch (error) { report(error); }
          finally { busy(false); }
        });
        if (state.canPublish) row.append(restore);
        list.append(row);
      }
    } catch (error) { list.textContent = error.message || "לא ניתן לטעון גרסאות"; }
  }
  function report(error) {
    say(error.status === 409 ? `${error.message} השינויים המקומיים נשארו פתוחים; טען מחדש לאחר שתעתיק אותם.` : error.message || "הפעולה נכשלה", true);
  }
  async function loadPage(slug) {
    busy(true);
    say("טוען עמוד…");
    try {
      const result = await api(`page?slug=${encodeURIComponent(slug)}`);
      if (result.permissions) {
        state.canPublish = result.permissions.canPublish;
        buttons.publish.hidden = !state.canPublish;
        const usersLink = document.querySelector('.admin-header a[href="/admin/users"]');
        if (usersLink) usersLink.hidden = result.permissions.role !== "system_admin";
      }
      state.slug = result.slug;
      state.base = result.base;
      state.managedFields=result.managedFields||{};
      state.draft = result.draft;
      state.draft.fields ||= {};
      state.draft.order ||= result.base.sections.map((section) => section.id);
      state.revision = result.revision;
      state.publishedVersion = result.publishedVersion;
      state.dirty = false;
      state.selected = null;
      state.preview = false;
      buttons.preview.textContent = "תצוגה מקדימה";
      picker.value = state.slug;
      frame.src = `/admin/edit?slug=${encodeURIComponent(state.slug)}&v=${Date.now()}`;
      renderPanel();
      say(`העמוד נטען · ${state.publishedVersion ? `פורסם בגרסה ${state.publishedVersion}` : "עדיין לא פורסם"}`);
    } catch (error) { report(error); }
    finally { busy(false); }
  }
  async function save() {
    if (!state.base || !state.draft || (!state.dirty && state.revision > 0)) return true;
    if (state.draft.seo && !state.draft.seo.title.trim()) { selectTab("seo"); say("יש למלא כותרת עמוד", true); return false; }
    busy(true);
    say("שומר טיוטה…");
    try {
      const result = await api("save", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ slug: state.slug, revision: state.revision, draft: state.draft }) });
      state.revision = result.revision;
      state.dirty = false;
      say("הטיוטה נשמרה");
      return true;
    } catch (error) { report(error); return false; }
    finally { busy(false); }
  }
  buttons.save.addEventListener("click", save);
  buttons.preview.addEventListener("click", () => {
    state.preview = !state.preview;
    buttons.preview.textContent = state.preview ? "חזרה לעריכה" : "תצוגה מקדימה";
    send({ type: "cms:mode", preview: state.preview });
    say(state.preview ? "תצוגה מקדימה של הטיוטה הנוכחית" : "מצב עריכה");
  });
  buttons.publish.addEventListener("click", async () => {
    if (!(await save())) return;
    busy(true);
    say("מפרסם…");
    try {
      const result = await api("publish", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ slug: state.slug, revision: state.revision }) });
      state.revision = result.revision;
      state.publishedVersion = result.publishedVersion;
      say(`פורסם בהצלחה · גרסה ${result.publishedVersion}`);
      if (state.tab === "history") renderPanel();
    } catch (error) { report(error); }
    finally { busy(false); }
  });
  buttons.restore.addEventListener("click", () => selectTab("history"));
  picker.addEventListener("change", async () => {
    const next = picker.value;
    if (state.dirty && !(await save())) { picker.value = state.slug; return; }
    await loadPage(next);
  });
  document.querySelectorAll(".admin-tabs [data-tab]").forEach((button) => button.addEventListener("click", () => selectTab(button.dataset.tab)));
  frame.addEventListener("load", syncFrame);
  window.addEventListener("message", (event) => {
    if (event.origin !== location.origin || event.source !== frame.contentWindow || !event.data || typeof event.data !== "object") return;
    if (event.data.type === "cms:ready") syncFrame();
    if (event.data.type === "cms:select" && state.base?.fields[event.data.id]) {
      state.selected = event.data.id;
      selectTab("field");
    }
  });
  window.addEventListener("beforeunload", (event) => {
    if (!state.dirty) return;
    event.preventDefault();
    event.returnValue = "";
  });
  renderPanel();
  loadPage(picker.value || "/");
})();
