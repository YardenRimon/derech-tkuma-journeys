(() => {
  const root = document.querySelector('#user-management');
  if (!root) return;
  const list = document.querySelector('#users-list');
  const status = document.querySelector('#users-status');
  const create = document.querySelector('#create-user');
  const add = document.querySelector('#add-user');
  let currentEmail = root.dataset.currentEmail;
  let busy = false;

  function node(tag, text, className) {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = text;
    if (className) element.className = className;
    return element;
  }
  function say(message, error = false) { status.textContent = message; status.classList.toggle('is-error', error); }
  async function api(body) {
    const response = await fetch('/api/users', {
      credentials: 'same-origin', cache: 'no-store',
      ...(body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) { list.replaceChildren(); create.hidden = true; add.hidden = true; }
      throw new Error(result.error || 'לא ניתן להשלים את הפעולה');
    }
    return result;
  }
  function control(label, input) {
    const wrapper = node('label', undefined, 'user-control');
    wrapper.append(node('span', label), input);
    return wrapper;
  }
  function rolePicker(role) {
    const select = node('select'); select.name = 'role';
    for (const [value, label] of [['content_editor', 'עורך תוכן'], ['system_admin', 'מנהל מערכת']]) {
      const option = node('option', label); option.value = value; select.append(option);
    }
    select.value = role;
    return select;
  }
  function checkbox(name, checked) { const input = node('input'); input.type = 'checkbox'; input.name = name; input.checked = checked; return input; }
  function publishBinding(role, permission) {
    const sync = () => { permission.disabled = role.value === 'system_admin'; if (permission.disabled) permission.checked = true; };
    role.addEventListener('change', () => { permission.checked = false; sync(); });
    sync();
  }
  function createVisible(visible) {
    create.hidden = !visible; add.setAttribute('aria-expanded', String(visible));
    if (visible) create.elements.email.focus(); else add.focus();
  }
  async function load() {
    const result = await api(); currentEmail = result.currentEmail;
    list.replaceChildren();
    for (const user of result.users) {
      const card = node('article', undefined, 'user-card');
      const heading = node('div', undefined, 'user-card-heading');
      const identity = node('div');
      const email = node('h2', user.email); email.dir = 'ltr';
      identity.append(email, node('p', `${user.role === 'system_admin' ? 'מנהל מערכת' : 'עורך תוכן'}${user.canPublish && user.role !== 'system_admin' ? ' · רשאי לפרסם' : ''}`, 'user-role'));
      if (user.email === currentEmail) identity.append(node('span', 'החשבון שלך', 'user-self'));
      const badge = node('span', user.active ? 'פעיל' : 'מושעה', user.active ? 'user-badge' : 'user-badge suspended');
      heading.append(identity, badge); card.append(heading);
      card.append(node('p', user.lastLoginAt ? 'התחבר לאתר' : 'טרם התחבר לאתר', 'admin-hint'));
      const detail = node('details'); detail.append(node('summary', 'עריכת הרשאות'));
      const form = node('form', undefined, 'user-form');
      const role = rolePicker(user.role);
      const publish = checkbox('canPublish', user.canPublish);
      const active = checkbox('active', user.active);
      publishBinding(role, publish);
      const publishLabel = control('הרשאת פרסום ושחזור גרסאות', publish); publishLabel.classList.add('user-checkbox');
      const activeLabel = control('גישה פעילה למערכת', active); activeLabel.classList.add('user-checkbox');
      form.append(control('תפקיד', role), publishLabel, activeLabel);
      const own = user.email === currentEmail;
      if (own) {
        role.disabled = true; active.disabled = true; publish.disabled = true;
        form.append(node('p', 'לא ניתן לשנות או להשעות את הרשאות החשבון המחובר.', 'admin-hint'));
      } else {
        const submit = node('button', 'שמירת הרשאות'); submit.type = 'submit'; form.append(submit);
        form.addEventListener('submit', async (event) => {
          event.preventDefault(); if (busy) return; busy = true; submit.disabled = true;
          try {
            await api({ op: 'update', email: user.email, revision: user.revision, role: role.value, active: active.checked, canPublish: role.value === 'system_admin' || publish.checked });
            await load(); say('ההרשאות נשמרו. הן חלות בבקשה הבאה של המשתמש.');
          } catch (error) { say(`${error.message}. אפשר לרענן את הרשימה ולנסות שוב.`, true); }
          finally { busy = false; submit.disabled = false; }
        });
      }
      detail.append(form); card.append(detail); list.append(card);
    }
  }
  publishBinding(create.elements.role, create.elements.canPublish);
  add.addEventListener('click', () => createVisible(create.hidden));
  document.querySelector('#cancel-create').addEventListener('click', () => createVisible(false));
  document.querySelector('#refresh-users').addEventListener('click', async () => {
    if (busy) return;
    try { await load(); say('הרשימה עודכנה'); } catch (error) { say(error.message, true); }
  });
  create.addEventListener('submit', async (event) => {
    event.preventDefault(); if (busy) return; busy = true;
    const submit = create.querySelector('[type="submit"]'); submit.disabled = true;
    try {
      await api({ op: 'create', email: create.elements.email.value.trim(), role: create.elements.role.value, canPublish: create.elements.role.value === 'system_admin' || create.elements.canPublish.checked });
      create.reset(); create.elements.canPublish.disabled = false; createVisible(false);
      await load(); say('המשתמש נוסף. הוא יכול להתחבר באימייל הזה דרך כניסת הצוות.');
    } catch (error) { say(error.message, true); }
    finally { busy = false; submit.disabled = false; }
  });
  load().then(() => say('הרשימה מעודכנת')).catch(error => say(error.message, true));
})();
