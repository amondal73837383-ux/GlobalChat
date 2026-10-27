(() => {
  const cfg = window.GLOBALCHAT_ADMIN_CONFIG || {};
  const $ = (id) => document.getElementById(id);
  const base = (cfg.API_BASE_URL || '').replace(/\/$/, '');
  let connected = false;
  const key = () => $('key').value.trim();
  const headers = () => ({ 'Content-Type': 'application/json', 'x-admin-api-key': key() });
  async function api(path, options = {}) {
    if (!base || !/^https:\/\//i.test(base)) throw new Error('Set a valid HTTPS API_BASE_URL in config.js.');
    const response = await fetch(base + path, { ...options, headers: { ...headers(), ...(options.headers || {}) } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
    return data;
  }
  function message(id, text, error = false) { $(id).textContent = text; $(id).classList.toggle('error', error); }
  function applyPreview() {
    const name = $('appName').value.trim() || 'GlobalChat';
    const color = /^#[0-9a-f]{6}$/i.test($('primaryColorText').value) ? $('primaryColorText').value : $('primaryColor').value;
    document.documentElement.style.setProperty('--accent', color);
    $('namePreview').textContent = name;
    $('announcementPreview').textContent = $('announcement').value.trim() || 'Your conversations, closer.';
    const url = $('logoUrl').value.trim();
    $('logoPreview').replaceChildren();
    if (url) { const img = document.createElement('img'); img.src = url; img.alt = 'App logo'; img.onerror = () => { $('logoPreview').textContent = 'G+'; }; $('logoPreview').append(img); }
    else $('logoPreview').textContent = 'G+';
  }
  async function loadDashboard() {
    message('message', 'Connecting to backend…');
    try {
      const [stats, remote] = await Promise.all([api('/api/admin/stats'), api('/api/admin/config')]);
      connected = true; $('connectionLabel').textContent = 'Connected'; $('connectionLabel').classList.add('connected');
      $('usersCount').textContent = Number(stats.users || 0).toLocaleString();
      $('conversationsCount').textContent = Number(stats.conversations || 0).toLocaleString();
      $('messagesCount').textContent = Number(stats.messages || 0).toLocaleString();
      $('databaseStatus').textContent = stats.database === 'connected' ? 'Online' : 'Offline';
      const c = remote.config || {};
      $('appName').value = c.appName || 'GlobalChat'; $('primaryColor').value = c.primaryColor || '#6d5dfc'; $('primaryColorText').value = (c.primaryColor || '#6d5dfc').toUpperCase();
      $('announcement').value = c.announcement || ''; $('logoUrl').value = c.logoUrl || ''; $('downloadUrl').value = c.downloadUrl || ''; $('maintenanceMode').checked = Boolean(c.maintenanceMode);
      applyPreview(); $('lastUpdated').textContent = 'Updated ' + new Date().toLocaleTimeString();
      message('message', 'Connected successfully. Live service data loaded.');
      await searchUsers();
    } catch (e) { connected = false; $('connectionLabel').textContent = 'Not connected'; $('connectionLabel').classList.remove('connected'); message('message', e.message, true); }
  }
  async function saveSettings() {
    if (!connected) return message('saveMessage', 'Connect to the backend first.', true);
    const color = $('primaryColorText').value.trim();
    if (!/^#[0-9a-f]{6}$/i.test(color)) return message('saveMessage', 'Enter a valid six-digit hex color.', true);
    const payload = { appName: $('appName').value.trim(), primaryColor: color, announcement: $('announcement').value.trim(), logoUrl: $('logoUrl').value.trim(), downloadUrl: $('downloadUrl').value.trim(), maintenanceMode: $('maintenanceMode').checked };
    try { await api('/api/admin/config', { method: 'PUT', body: JSON.stringify(payload) }); message('saveMessage', 'Settings saved to the backend.'); applyPreview(); }
    catch (e) { message('saveMessage', e.message, true); }
  }
  async function searchUsers() {
    if (!connected) return;
    const body = $('usersTable'); body.innerHTML = '<tr><td colspan="5" class="empty">Loading users…</td></tr>';
    try {
      const result = await api('/api/admin/users?q=' + encodeURIComponent($('userQuery').value.trim()));
      body.replaceChildren();
      if (!result.users?.length) { body.innerHTML = '<tr><td colspan="5" class="empty">No matching users found.</td></tr>'; return; }
      result.users.forEach((user) => {
        const tr = document.createElement('tr');
        const identity = document.createElement('td'); const strong = document.createElement('strong'); strong.textContent = user.displayName || 'Unnamed user'; const small = document.createElement('small'); small.textContent = user.createdAt ? new Date(user.createdAt).toLocaleDateString() : ''; identity.append(strong, small);
        const id = document.createElement('td'); id.textContent = user.userId;
        const phone = document.createElement('td'); phone.textContent = user.phoneNumber || '—';
        const status = document.createElement('td'); const pill = document.createElement('span'); pill.className = 'user-status ' + (user.blocked ? 'blocked' : 'active'); pill.textContent = user.blocked ? 'Blocked' : 'Active'; status.append(pill);
        const action = document.createElement('td'); const btn = document.createElement('button'); btn.className = 'button ' + (user.blocked ? 'secondary' : 'danger'); btn.textContent = user.blocked ? 'Unblock' : 'Block'; btn.onclick = () => toggleBlock(user.userId, !user.blocked); action.append(btn);
        tr.append(identity, id, phone, status, action); body.append(tr);
      });
      message('usersMessage', `${result.users.length} user(s) shown. Maximum 50 results per search.`);
    } catch (e) { body.innerHTML = '<tr><td colspan="5" class="empty">Could not load users.</td></tr>'; message('usersMessage', e.message, true); }
  }
  async function toggleBlock(userId, blocked) {
    const action = blocked ? 'block' : 'unblock';
    if (!window.confirm(`Are you sure you want to ${action} account ${userId}?`)) return;
    try { await api(`/api/admin/users/${encodeURIComponent(userId)}/block`, { method: 'PATCH', body: JSON.stringify({ blocked }) }); message('usersMessage', `Account ${userId} ${blocked ? 'blocked' : 'unblocked'}.`); await searchUsers(); }
    catch (e) { message('usersMessage', e.message, true); }
  }
  $('load').onclick = loadDashboard; $('refresh').onclick = loadDashboard; $('save').onclick = saveSettings;
  $('searchForm').addEventListener('submit', (e) => { e.preventDefault(); searchUsers(); });
  $('primaryColor').addEventListener('input', () => { $('primaryColorText').value = $('primaryColor').value.toUpperCase(); applyPreview(); });
  ['appName', 'primaryColorText', 'announcement', 'logoUrl'].forEach((id) => $(id).addEventListener('input', applyPreview));
  $('key').addEventListener('keydown', (e) => { if (e.key === 'Enter') loadDashboard(); });
  applyPreview();
})();
