/**
 * GLM Bonus Radar service worker.
 *
 * Deliberately MINIMAL: it exists to make the site installable as a PWA.
 * It never calls respondWith, so every request goes to the network exactly
 * as before — zero risk of serving stale portal data (the whole point of a
 * "live" radar). Push-notification handling lives with the Notification
 * API permission flow in the app; no push subscription is stored here.
 */

const CACHE = "br-shell-v1";
const SHELL = ["/", "/icon-192.png", "/icon-512.png", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .catch(() => {}),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Present but passive: no respondWith → all requests hit the network as usual.
// (Chrome requires a fetch handler for installability; a no-op is the safest one.)
self.addEventListener("fetch", () => {});

// Allow the page to trigger a silent update check.
self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});
