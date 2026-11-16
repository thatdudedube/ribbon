/* Ribbon service worker: works offline from a cache, always prefers the newest files, and shows reminders. */
const VERSION = "%%RIBBON_VERSION%%";
const CACHE = "ribbon-" + VERSION;
const SHELL = ["./", "index.html", "ribbon-firebase.js", "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png", "icons/apple-touch-icon.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).catch(() => {}).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith("ribbon-") && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const req = e.request; const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin) return;
  if (url.pathname.endsWith("/version.json")) return; /* always from the network */
  e.respondWith(
    fetch(url.href, { cache: "no-cache", credentials: "same-origin" }).then(res => {
      if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || (req.mode === "navigate" ? caches.match("index.html") : undefined)).then(r => r || Response.error()))
  );
});
self.addEventListener("push", e => {
  let p = {}; try { p = e.data ? e.data.json() : {}; } catch (x) { p = { data: { body: e.data && e.data.text() } }; }
  const d = p.data || {}, n = p.notification || {};
  const title = d.title || n.title || "Ribbon";
  e.waitUntil(self.registration.showNotification(title, {
    body: d.body || n.body || "", icon: "icons/icon-192.png", badge: "icons/icon-192.png",
    tag: d.tag || undefined, data: { url: d.url || "./" }
  }));
});
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const target = new URL((e.notification.data && e.notification.data.url) || "./", self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
    for (const c of list) { if (c.url.startsWith(self.registration.scope) && "focus" in c) return c.focus(); }
    return self.clients.openWindow(target);
  }));
});
