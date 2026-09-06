const ROOT = new URL("./", self.location).href;
const PREFIX = `side-a:${new URL(ROOT).pathname}:`;
const CACHE = PREFIX + "v1";
const SHELL = [
  "",
  "index.html",
  "styles.css",
  "app.js",
  "config.js",
  "lib/record.js",
  "manifest.webmanifest",
  "assets/icon.svg",
  "assets/icon-192.png",
  "assets/icon-512.png",
  "assets/placeholder.svg",
  "assets/zxing-browser.min.js",
  "data/records.json",
];
self.addEventListener("install", (event) =>
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(SHELL.map((p) => new URL(p, ROOT).href))),
  ),
);
self.addEventListener("activate", (event) =>
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith(PREFIX) && k !== CACHE)
            .map((k) => caches.delete(k)),
        ),
      ),
  ),
);
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (
    event.request.method !== "GET" ||
    url.origin !== self.location.origin ||
    !url.href.startsWith(ROOT)
  )
    return;
  const relative = url.pathname.slice(new URL(ROOT).pathname.length);
  if (!SHELL.includes(relative) && relative !== "data/records.json") return;
  const key = new URL(relative || "index.html", ROOT).href;
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      try {
        const response = await fetch(event.request);
        if (response.ok) await cache.put(key, response.clone());
        return response;
      } catch {
        const saved = await cache.match(key);
        return saved || new Response("Offline", { status: 503 });
      }
    })(),
  );
});
