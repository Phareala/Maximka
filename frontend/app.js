const state = {
  me: null,
  settings: null,
  chats: [],
  activeChatId: null,
  messages: [],
  selectedGroupMembers: new Map(),
  replyTo: null,
  pendingFile: null,
};

const els = {
  authView: document.getElementById('authView'),
  appView: document.getElementById('appView'),
  toastContainer: document.getElementById('toastContainer'),
  showRegisterBtn: document.getElementById('showRegisterBtn'),
  showLoginBtn: document.getElementById('showLoginBtn'),
  loginCard: document.getElementById('loginCard'),
  registerCard: document.getElementById('registerCard'),
  registerForm: document.getElementById('registerForm'),
  loginForm: document.getElementById('loginForm'),
  navBar: document.getElementById('navBar'),
  logoutBtn: document.getElementById('logoutBtn'),
  pages: Array.from(document.querySelectorAll('.page')),
  sidebarMe: document.getElementById('sidebarMe'),
  sidebarSearchInput: document.getElementById('sidebarSearchInput'),
  sidebarSearchBtn: document.getElementById('sidebarSearchBtn'),
  sidebarChatList: document.getElementById('sidebarChatList'),
  chatPlaceholder: document.getElementById('chatPlaceholder'),
  chatWorkspace: document.getElementById('chatWorkspace'),
  chatAvatar: document.getElementById('chatAvatar'),
  chatTitle: document.getElementById('chatTitle'),
  chatSubtitle: document.getElementById('chatSubtitle'),
  chatMeta: document.getElementById('chatMeta'),
  messageList: document.getElementById('messageList'),
  messageForm: document.getElementById('messageForm'),
  messageInput: document.getElementById('messageInput'),
  messageFileInput: document.getElementById('messageFileInput'),
  replyBox: document.getElementById('replyBox'),
  filePreviewBox: document.getElementById('filePreviewBox'),
  groupForm: document.getElementById('groupForm'),
  groupAvatarInput: document.getElementById('groupAvatarInput'),
  groupAvatarPreview: document.getElementById('groupAvatarPreview'),
  groupMemberSearch: document.getElementById('groupMemberSearch'),
  groupMemberResults: document.getElementById('groupMemberResults'),
  groupSelectedMembers: document.getElementById('groupSelectedMembers'),
  globalSearchInput: document.getElementById('globalSearchInput'),
  globalSearchBtn: document.getElementById('globalSearchBtn'),
  globalSearchResults: document.getElementById('globalSearchResults'),
  profileForm: document.getElementById('profileForm'),
  profileDisplayName: document.getElementById('profileDisplayName'),
  profileAvatarInput: document.getElementById('profileAvatarInput'),
  currentAvatarPreview: document.getElementById('currentAvatarPreview'),
  newAvatarPreview: document.getElementById('newAvatarPreview'),
  profileStatusText: document.getElementById('profileStatusText'),
  settingThemeMode: document.getElementById('settingThemeMode'),
  settingColorTheme: document.getElementById('settingColorTheme'),
  settingFontSize: document.getElementById('settingFontSize'),
  settingFontSizeValue: document.getElementById('settingFontSizeValue'),
  settingDensityMode: document.getElementById('settingDensityMode'),
  settingBrowserNotifications: document.getElementById('settingBrowserNotifications'),
  settingSoundNotifications: document.getElementById('settingSoundNotifications'),
  settingToastNotifications: document.getElementById('settingToastNotifications'),
  saveSettingsBtn: document.getElementById('saveSettingsBtn'),
};

async function api(path, options = {}) {
  const config = {
    credentials: 'include',
    headers: {},
    ...options,
  };
  if (options.body && !(options.body instanceof FormData)) {
    config.headers['Content-Type'] = 'application/json';
    config.body = JSON.stringify(options.body);
  }
  const response = await fetch(path, config);
  let data;
  try { data = await response.json(); } catch { data = {}; }
  if (!response.ok) throw new Error(data.error || 'Ошибка запроса');
  return data;
}

function toast(text, type = 'info') {
  const div = document.createElement('div');
  div.className = `toast ${type === 'error' ? 'error' : ''}`;
  div.textContent = text;
  els.toastContainer.appendChild(div);
  setTimeout(() => div.remove(), 3500);
}

function setMode(mode) {
  document.body.dataset.mode = mode;
  els.authView.classList.toggle('hidden', mode !== 'auth');
  els.appView.classList.toggle('hidden', mode !== 'app');
}

function escapeHtml(v) {
  return (v || '').replace(/[&<>"']/g, ch => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[ch]));
}

function avatarMarkup(userLike, large = false) {
  if (!userLike) return `<div class="avatar ${large ? 'avatar-lg' : ''}">??</div>`;
  if (userLike.avatar_url) {
    return `<div class="avatar ${large ? 'avatar-lg' : ''}"><img src="${userLike.avatar_url}" alt="avatar"></div>`;
  }
  return `<div class="avatar ${large ? 'avatar-lg' : ''}">${escapeHtml(userLike.initials || '??')}</div>`;
}

function fillAvatarPreview(container, url, placeholder = 'Нет аватарки') {
  container.classList.remove('empty');
  container.innerHTML = url ? `<img src="${url}" alt="preview">` : `<span>${placeholder}</span>`;
}

function showAuthCard(which) {
  els.loginCard.classList.toggle('hidden', which !== 'login');
  els.registerCard.classList.toggle('hidden', which !== 'register');
}

function activatePage(page) {
  els.pages.forEach(p => p.classList.toggle('active', p.id === `page${page[0].toUpperCase()}${page.slice(1)}`));
  document.querySelectorAll('.nav-link[data-page]').forEach(btn => btn.classList.toggle('active', btn.dataset.page === page));
}

function renderMeMini() {
  if (!state.me) return;
  els.sidebarMe.innerHTML = `${avatarMarkup(state.me)}
    <div>
      <div class="section-title">${escapeHtml(state.me.display_name)}</div>
      <div class="muted">@${escapeHtml(state.me.login)} · ${escapeHtml(state.me.user_status_label)}</div>
    </div>`;
}

function formatDate(iso) {
  const d = new Date(iso);
  return d.toLocaleString('ru-RU', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' });
}

function renderChatList() {
  const query = (els.sidebarSearchInput.value || '').trim().toLowerCase();
  const visibleChats = state.chats.filter(chat => !query || (chat.title || '').toLowerCase().includes(query) || (chat.subtitle || '').toLowerCase().includes(query));
  els.sidebarChatList.innerHTML = visibleChats.map(chat => `
    <article class="chat-card ${chat.chat_id === state.activeChatId ? 'active' : ''}" data-chat-id="${chat.chat_id}">
      <div class="chat-card-main">
        ${chat.avatar_url ? `<div class="avatar"><img src="${chat.avatar_url}" alt="avatar"></div>` : `<div class="avatar">${escapeHtml((chat.title || 'Чат').slice(0,2).toUpperCase())}</div>`}
        <div class="chat-card-body">
          <div class="chat-card-title-row">
            <div class="chat-card-title truncate">${escapeHtml(chat.title)}</div>
          </div>
          <div class="muted truncate">${escapeHtml(chat.subtitle || '')}</div>
          <div class="truncate">${escapeHtml(chat.last_message || 'Пока пусто')}</div>
        </div>
      </div>
      <div class="chat-card-side">
        ${chat.last_message_time ? `<div class="time-label">${formatDate(chat.last_message_time)}</div>` : ''}
        ${chat.has_unread ? `<div class="unread-badge">${chat.unread_count}</div>` : ''}
      </div>
    </article>`).join('') || '<div class="muted">Чатов пока нет</div>';

  els.chatPlaceholder.classList.add('placeholder-state');
  els.chatPlaceholder.innerHTML = `<div class="chat-list-view"><h2>Все чаты</h2><div class="muted">Выбери чат слева или найди человека во вкладке «Поиск».</div></div>`;
  els.sidebarChatList.querySelectorAll('.chat-card').forEach(card => card.addEventListener('click', () => openChat(Number(card.dataset.chatId))));
}

async function loadChats() {
  const data = await api('/api/chats');
  state.chats = data.chats;
  renderChatList();
}

function renderMessage(msg) {
  const attachment = msg.attachment ? renderAttachment(msg.attachment) : '';
  const reply = msg.reply_to ? `<div class="reply-pill"><strong>${escapeHtml(msg.reply_to.sender_name)}</strong><div>${escapeHtml(msg.reply_to.message_text)}</div></div>` : '';
  return `<article class="message-card ${msg.is_own ? 'own' : ''}" data-message-id="${msg.message_id}">
    <div class="message-top">
      <div class="message-sender">${escapeHtml(msg.sender?.display_name || 'Пользователь')}</div>
      <div class="message-meta">${formatDate(msg.created_at)}</div>
    </div>
    ${reply}
    ${msg.message_html ? `<div>${msg.message_html}</div>` : ''}
    ${attachment}
    <div class="message-actions">
      <span class="message-meta">${escapeHtml(msg.delivery_status)}</span>
      <button class="inline-btn" data-reply="${msg.message_id}">Ответить</button>
      ${msg.is_own ? `<button class="inline-btn" data-edit="${msg.message_id}">Изменить</button><button class="inline-btn delete" data-delete="${msg.message_id}">Удалить</button>` : ''}
    </div>
  </article>`;
}

function renderAttachment(att) {
  if (att.kind === 'image') {
    return `<div class="file-pill"><img class="preview-media" src="${att.file_url}" alt="image"></div>`;
  }
  if (att.kind === 'video') {
    return `<div class="file-pill"><video class="preview-media" controls src="${att.file_url}"></video></div>`;
  }
  if (att.kind === 'audio') {
    return `<div class="file-pill"><audio controls src="${att.file_url}"></audio></div>`;
  }
  return `<div class="file-pill"><a href="${att.file_url}" target="_blank">📎 ${escapeHtml(att.file_name)}</a></div>`;
}

function bindMessageActions() {
  els.messageList.querySelectorAll('[data-reply]').forEach(btn => btn.addEventListener('click', () => {
    const msg = state.messages.find(m => m.message_id === Number(btn.dataset.reply));
    if (!msg) return;
    state.replyTo = msg;
    els.replyBox.classList.remove('hidden');
    els.replyBox.innerHTML = `<strong>Ответ</strong>: ${escapeHtml(msg.sender?.display_name || '')} — ${escapeHtml((msg.message_text || '').slice(0, 140))} <button class="inline-btn" id="clearReplyBtn">Отменить</button>`;
    document.getElementById('clearReplyBtn').onclick = clearReply;
  }));
  els.messageList.querySelectorAll('[data-delete]').forEach(btn => btn.addEventListener('click', async () => {
    await api(`/api/messages/${btn.dataset.delete}`, { method: 'DELETE' });
    toast('Сообщение удалено');
    await openChat(state.activeChatId, true);
  }));
  els.messageList.querySelectorAll('[data-edit]').forEach(btn => btn.addEventListener('click', async () => {
    const msg = state.messages.find(m => m.message_id === Number(btn.dataset.edit));
    const nextText = prompt('Новое содержимое сообщения', msg?.message_text || '');
    if (nextText === null) return;
    await api(`/api/messages/${btn.dataset.edit}`, { method: 'PUT', body: { text: nextText } });
    toast('Сообщение обновлено');
    await openChat(state.activeChatId, true);
  }));
}

function clearReply() {
  state.replyTo = null;
  els.replyBox.classList.add('hidden');
  els.replyBox.innerHTML = '';
}

function renderMessages() {
  els.messageList.innerHTML = state.messages.map(renderMessage).join('');
  bindMessageActions();
  els.messageList.scrollTop = els.messageList.scrollHeight;
}

async function openChat(chatId, skipListReload = false) {
  state.activeChatId = chatId;
  if (!skipListReload) await loadChats();
  const [chatData, messagesData] = await Promise.all([api(`/api/chats/${chatId}`), api(`/api/chats/${chatId}/messages`)]);
  const chat = chatData.chat;
  state.messages = messagesData.messages;
  els.chatPlaceholder.classList.add('hidden');
  els.chatWorkspace.classList.remove('hidden');
  els.chatAvatar.innerHTML = chat.avatar_url ? `<img src="${chat.avatar_url}" alt="avatar">` : escapeHtml((chat.title || 'Чат').slice(0,2).toUpperCase());
  els.chatTitle.textContent = chat.title;
  els.chatSubtitle.textContent = chat.subtitle || '';
  els.chatMeta.innerHTML = chat.chat_type === 'group'
    ? `<div>${chat.members.length} участников</div>`
    : '';
  renderMessages();
}

async function sendMessage(event) {
  event.preventDefault();
  if (!state.activeChatId) return;
  const form = new FormData();
  const text = els.messageInput.value.trim();
  if (text) form.append('text', text);
  if (state.replyTo) form.append('reply_to_message_id', String(state.replyTo.message_id));
  if (state.pendingFile) form.append('file', state.pendingFile);
  await api(`/api/chats/${state.activeChatId}/messages`, { method: 'POST', body: form });
  els.messageInput.value = '';
  els.messageFileInput.value = '';
  state.pendingFile = null;
  clearReply();
  clearFilePreview();
  await openChat(state.activeChatId, true);
  await loadChats();
}

function clearFilePreview() {
  state.pendingFile = null;
  els.filePreviewBox.classList.add('hidden');
  els.filePreviewBox.innerHTML = '';
}

function showFilePreview(file) {
  if (!file) return clearFilePreview();
  state.pendingFile = file;
  const mime = file.type || '';
  let html = `<div><strong>${escapeHtml(file.name)}</strong> · ${(file.size / 1024).toFixed(1)} КБ <button class="inline-btn" id="clearFilePreviewBtn">Убрать</button></div>`;
  if (mime.startsWith('image/')) {
    html += `<img class="preview-media" id="pendingImg" alt="preview">`;
  } else if (mime.startsWith('video/')) {
    html += `<video class="preview-media" id="pendingVideo" controls></video>`;
  }
  els.filePreviewBox.classList.remove('hidden');
  els.filePreviewBox.innerHTML = html;
  document.getElementById('clearFilePreviewBtn').onclick = clearFilePreview;
  const url = URL.createObjectURL(file);
  const img = document.getElementById('pendingImg');
  const video = document.getElementById('pendingVideo');
  if (img) img.src = url;
  if (video) video.src = url;
}

async function searchUsers(targetContainer, query) {
  const data = await api(`/api/users/search?q=${encodeURIComponent(query || '')}`);
  targetContainer.innerHTML = data.users.map(u => `
    <article class="user-result">
      ${avatarMarkup(u)}
      <div class="user-result-main">
        <div class="section-title">${escapeHtml(u.display_name)}</div>
        <div class="muted">@${escapeHtml(u.login)} · ${escapeHtml(u.user_status_label)}</div>
      </div>
      <div class="user-actions">
        <button class="btn btn-secondary" data-open-chat="${u.user_id}">Открыть диалог</button>
        ${targetContainer === els.groupMemberResults ? `<button class="btn btn-secondary" data-add-group="${u.user_id}">Добавить</button>` : ''}
      </div>
    </article>`).join('') || `<div class="muted">Ничего не найдено</div>`;
  targetContainer.querySelectorAll('[data-open-chat]').forEach(btn => btn.addEventListener('click', async () => {
    const res = await api('/api/chats/private', { method: 'POST', body: { user_id: Number(btn.dataset.openChat) } });
    activatePage('chats');
    await loadChats();
    await openChat(res.chat_id, true);
  }));
  targetContainer.querySelectorAll('[data-add-group]').forEach(btn => btn.addEventListener('click', () => addGroupMember(Number(btn.dataset.addGroup), data.users.find(u => u.user_id === Number(btn.dataset.addGroup)))));
}

function addGroupMember(userId, user) {
  if (!user) return;
  state.selectedGroupMembers.set(userId, user);
  renderSelectedMembers();
}

function renderSelectedMembers() {
  els.groupSelectedMembers.innerHTML = Array.from(state.selectedGroupMembers.values()).map(u => `<div class="chip">${escapeHtml(u.display_name)} <button class="inline-btn" data-remove-chip="${u.user_id}">×</button></div>`).join('') || '<span class="muted">Пока никого</span>';
  els.groupSelectedMembers.querySelectorAll('[data-remove-chip]').forEach(btn => btn.addEventListener('click', () => {
    state.selectedGroupMembers.delete(Number(btn.dataset.removeChip));
    renderSelectedMembers();
  }));
}

async function createGroup(event) {
  event.preventDefault();
  const form = new FormData(els.groupForm);
  form.append('member_ids', Array.from(state.selectedGroupMembers.keys()).join(','));
  const res = await api('/api/chats/group', { method: 'POST', body: form });
  toast('Группа создана');
  els.groupForm.reset();
  fillAvatarPreview(els.groupAvatarPreview, null, 'Нет аватарки');
  state.selectedGroupMembers.clear();
  renderSelectedMembers();
  activatePage('chats');
  await loadChats();
  await openChat(res.chat_id, true);
}

function applySettingsUI(settings) {
  document.body.style.setProperty('--font-size', `${settings.font_size}px`);
  document.body.dataset.theme = settings.color_theme;
  document.body.classList.toggle('compact', settings.density_mode === 'compact');
  const mode = settings.theme_mode === 'system'
    ? (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
    : settings.theme_mode;
  document.body.classList.toggle('light', mode === 'light');
  els.settingThemeMode.value = settings.theme_mode;
  els.settingColorTheme.value = settings.color_theme;
  els.settingFontSize.value = settings.font_size;
  els.settingFontSizeValue.textContent = `${settings.font_size}px`;
  els.settingDensityMode.value = settings.density_mode;
  els.settingBrowserNotifications.checked = settings.browser_notifications;
  els.settingSoundNotifications.checked = settings.sound_notifications;
  els.settingToastNotifications.checked = settings.toast_notifications;
}

async function saveSettings() {
  const body = {
    theme_mode: els.settingThemeMode.value,
    color_theme: els.settingColorTheme.value,
    font_size: Number(els.settingFontSize.value),
    density_mode: els.settingDensityMode.value,
    browser_notifications: els.settingBrowserNotifications.checked,
    sound_notifications: els.settingSoundNotifications.checked,
    toast_notifications: els.settingToastNotifications.checked,
  };
  const data = await api('/api/settings', { method: 'PUT', body });
  state.settings = data.settings;
  applySettingsUI(state.settings);
  toast('Настройки сохранены');
}

function renderProfile() {
  if (!state.me) return;
  els.profileDisplayName.value = state.me.display_name;
  fillAvatarPreview(els.currentAvatarPreview, state.me.avatar_url, 'Нет аватарки');
  fillAvatarPreview(els.newAvatarPreview, null, 'Выбери файл');
  els.profileStatusText.textContent = `Сейчас: ${state.me.user_status_label}`;
}

async function saveProfile(event) {
  event.preventDefault();
  const form = new FormData();
  form.append('display_name', els.profileDisplayName.value.trim());
  if (els.profileAvatarInput.files[0]) form.append('avatar', els.profileAvatarInput.files[0]);
  const data = await api('/api/profile', { method: 'PUT', body: form });
  state.me = data.user;
  renderMeMini();
  renderProfile();
  await loadChats();
  toast('Профиль обновлён');
}

async function bootstrap() {
  try {
    const data = await api('/api/me');
    state.me = data.user;
    state.settings = data.settings;
    setMode('app');
    activatePage('chats');
    renderMeMini();
    applySettingsUI(state.settings);
    renderProfile();
    await loadChats();
  } catch {
    setMode('auth');
    showAuthCard('login');
  }
}

async function seedIfNeeded() {
  try { await api('/api/seed'); } catch {}
}

els.showRegisterBtn.addEventListener('click', () => showAuthCard('register'));
els.showLoginBtn.addEventListener('click', () => showAuthCard('login'));
els.loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const form = new FormData(els.loginForm);
    const data = await api('/api/login', { method: 'POST', body: Object.fromEntries(form.entries()) });
    state.me = data.user;
    const meData = await api('/api/me');
    state.settings = meData.settings;
    setMode('app');
    activatePage('chats');
    renderMeMini();
    applySettingsUI(state.settings);
    renderProfile();
    await loadChats();
    toast('Вход выполнен');
  } catch (err) {
    toast(err.message, 'error');
  }
});

els.registerForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const form = new FormData(els.registerForm);
    const login = form.get('login');
    await api('/api/register', { method: 'POST', body: Object.fromEntries(form.entries()) });
    els.registerForm.reset();
    els.loginForm.reset();
    els.loginForm.querySelector('[name="login"]').value = login;
    showAuthCard('login');
    toast('Аккаунт создан. Теперь войди.');
  } catch (err) {
    toast(err.message, 'error');
  }
});

els.logoutBtn.addEventListener('click', async () => {
  await api('/api/logout', { method: 'POST' });
  state.me = null;
  state.activeChatId = null;
  setMode('auth');
  showAuthCard('login');
});

els.navBar.addEventListener('click', (event) => {
  const btn = event.target.closest('[data-page]');
  if (!btn) return;
  activatePage(btn.dataset.page);
});

els.sidebarSearchBtn.addEventListener('click', renderChatList);
els.sidebarSearchInput.addEventListener('input', renderChatList);
els.globalSearchBtn.addEventListener('click', () => searchUsers(els.globalSearchResults, els.globalSearchInput.value.trim()));
els.groupMemberSearch.addEventListener('input', () => searchUsers(els.groupMemberResults, els.groupMemberSearch.value.trim()));
els.messageForm.addEventListener('submit', sendMessage);
els.messageFileInput.addEventListener('change', e => showFilePreview(e.target.files[0]));
els.groupForm.addEventListener('submit', createGroup);
els.profileForm.addEventListener('submit', saveProfile);
els.profileAvatarInput.addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return fillAvatarPreview(els.newAvatarPreview, null, 'Выбери файл');
  fillAvatarPreview(els.newAvatarPreview, URL.createObjectURL(file));
});
els.groupAvatarInput.addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return fillAvatarPreview(els.groupAvatarPreview, null, 'Нет аватарки');
  fillAvatarPreview(els.groupAvatarPreview, URL.createObjectURL(file));
});
els.saveSettingsBtn.addEventListener('click', saveSettings);
els.settingFontSize.addEventListener('input', () => els.settingFontSizeValue.textContent = `${els.settingFontSize.value}px`);

window.addEventListener('mousemove', () => state.me && api('/api/activity', { method: 'POST' }).catch(() => {}), { passive: true });
setInterval(() => {
  if (state.me) api('/api/activity', { method: 'POST' }).catch(() => {});
}, 60_000);

seedIfNeeded().then(bootstrap);
