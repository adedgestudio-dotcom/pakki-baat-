const VERSION = "pakki-baat-v2";
const SHELL_CACHE = VERSION + "-shell";
const RUNTIME_CACHE = VERSION + "-runtime";
const CORE = ["/manifest.json", "/icon.svg", "/apple-icon.svg"];

async function cacheAppShell() {
  const cache = await caches.open(SHELL_CACHE);
  await Promise.allSettled(CORE.map((url) => cache.add(url)));

  try {
    const response = await fetch("/", { cache: "reload" });
    if (!response || !response.ok) return;
    await cache.put("/", response.clone());

    const html = await response.text();
    const assetUrls = Array.from(
      html.matchAll(/(?:src|href)=["']([^"']+)["']/g),
      (match) => match[1]
    )
      .filter((url) => url.startsWith("/_next/static/") || /\.(?:css|js|woff2?|svg|png|webp)$/i.test(url))
      .filter((url, index, list) => list.indexOf(url) === index);

    await Promise.allSettled(assetUrls.map((url) => cache.add(url)));
  } catch {
    // The current page remains usable and runtime caching can complete later.
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    await cacheAppShell();
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(
      names
        .filter((name) => name.startsWith("pakki-baat-") && ![SHELL_CACHE, RUNTIME_CACHE].includes(name))
        .map((name) => caches.delete(name))
    );
    await self.clients.claim();
  })());
});

self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
  if (event.data === "CACHE_APP_SHELL") {
    event.waitUntil(cacheAppShell());
  }
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        if (response && response.ok) {
          const cache = await caches.open(RUNTIME_CACHE);
          await cache.put(request, response.clone());
        }
        return response;
      } catch {
        return (
          (await caches.match(request)) ||
          (await caches.match("/")) ||
          new Response("Pakki Baat is offline. Reconnect once to finish loading the app.", {
            status: 503,
            headers: { "Content-Type": "text/plain; charset=utf-8" },
          })
        );
      }
    })());
    return;
  }

  const isStaticAsset =
    url.pathname.startsWith("/_next/static/") ||
    /\.(?:js|css|woff2?|png|jpg|jpeg|webp|svg|ico)$/i.test(url.pathname);

  if (isStaticAsset) {
    event.respondWith((async () => {
      const cached = await caches.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (response && response.ok) {
        const cache = await caches.open(RUNTIME_CACHE);
        await cache.put(request, response.clone());
      }
      return response;
    })());
    return;
  }

  event.respondWith((async () => {
    const cached = await caches.match(request);
    const network = fetch(request)
      .then(async (response) => {
        if (response && response.ok) {
          const cache = await caches.open(RUNTIME_CACHE);
          await cache.put(request, response.clone());
        }
        return response;
      })
      .catch(() => null);

    return cached || (await network) || Response.error();
  })());
});


self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification?.data?.url || "/";
  event.waitUntil((async () => {
    const clientsList = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of clientsList) {
      if ("focus" in client) {
        try {
          await client.focus();
          if ("navigate" in client) await client.navigate(targetUrl);
          return;
        } catch {}
      }
    }
    if (self.clients.openWindow) await self.clients.openWindow(targetUrl);
  })());
});


self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "You have a Pakki Baat reminder." };
  }

  const title = data.title || "Pakki Baat reminder";
  const options = {
    body: data.body || "You have a reminder.",
    icon: "/icon.svg",
    badge: "/icon.svg",
    tag: data.reminderId ? "pakki-baat-reminder-" + data.reminderId : "pakki-baat-reminder",
    requireInteraction: true,
    renotify: true,
    vibrate: [350, 180, 350, 180, 650],
    data: {
      url: data.url || "/",
      reminderId: data.reminderId || "",
    },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});
