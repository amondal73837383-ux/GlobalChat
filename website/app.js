(() => {
  const cfg = window.GLOBALCHAT_CONFIG || {};
  const status = document.getElementById('apiStatus');
  const download = document.getElementById('downloadLink');
  document.getElementById('year').textContent = new Date().getFullYear();
  const base = (cfg.API_BASE_URL || '').replace(/\/$/, '');
  if (!base || !/^https:\/\//i.test(base)) {
    status.textContent = 'Set the backend URL in website/config.js to connect this site.';
    return;
  }
  fetch(base + '/health').then((r) => { if (!r.ok) throw new Error(); return r.json(); }).then((health) => {
    status.textContent = `API ${health.status} · Database ${health.database}`;
    status.classList.toggle('service-ok', health.status === 'ok' && health.database === 'connected');
  }).catch(() => { status.textContent = 'The API is temporarily unreachable. Please try again later.'; status.classList.add('service-error'); });
  fetch(base + '/api/config').then((r) => r.ok ? r.json() : Promise.reject()).then(({ config: remote = {} }) => {
    if (remote.appName) { document.title = `${remote.appName} — Conversations without borders`; document.querySelectorAll('.brand-name,.footer-name').forEach((el) => el.textContent = remote.appName); }
    if (remote.primaryColor && /^#[0-9a-f]{6}$/i.test(remote.primaryColor)) document.documentElement.style.setProperty('--brand-accent', remote.primaryColor);
    if (remote.announcement) { const note = document.getElementById('remoteAnnouncement'); if (note) { note.textContent = remote.announcement; note.hidden = false; } }
    if (remote.logoUrl && /^https:\/\//i.test(remote.logoUrl)) document.querySelectorAll('[data-app-logo]').forEach((el) => { el.innerHTML = ''; const img = document.createElement('img'); img.src = remote.logoUrl; img.alt = `${remote.appName || 'GlobalChat'} logo`; el.append(img); });
    if (remote.downloadUrl && /^https:\/\//i.test(remote.downloadUrl)) { download.href = remote.downloadUrl; download.classList.remove('disabled'); download.removeAttribute('aria-disabled'); download.textContent = 'Download Android APK ↓'; download.setAttribute('rel', 'noopener noreferrer'); }
    if (remote.maintenanceMode) { const note = document.getElementById('maintenanceNotice'); if (note) note.hidden = false; }
  }).catch(() => {});
})();
