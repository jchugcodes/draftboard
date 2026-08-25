// DraftBoard service worker — app shell cache-first, Sleeper API stale-while-revalidate.
// Bump SHELL on every deploy so installed clients pick up the new build.
const SHELL = "draftboard-shell-mt7wy16q";
const DATA = "draftboard-data-v1";
const ASSETS = ["./", "./index.html", "./app.js", "./styles.css", "./manifest.webmanifest", "./icons/icon.svg", "./icons/icon-192.png", "./icons/icon-512.png", "./fonts/montserrat-var.woff2", "./fonts/robotomono-var.woff2"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => ![SHELL, DATA].includes(k)).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  if (url.origin === location.origin) {
    // shell: cache-first
    e.respondWith(
      caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || fetch(e.request).then((res) => {
        const copy = res.clone();
        caches.open(SHELL).then((c) => c.put(e.request, copy));
        return res;
      }).catch(() => caches.match("./index.html")))
    );
  } else if (url.hostname === "api.sleeper.app") {
    // data: network-first, fall back to last cached copy offline
    e.respondWith(
      fetch(e.request).then((res) => {
        const copy = res.clone();
        caches.open(DATA).then((c) => c.put(e.request, copy));
        return res;
      }).catch(() => caches.match(e.request))
    );
  }
});
