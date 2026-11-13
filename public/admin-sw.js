self.addEventListener("push", event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch {}
  const title = typeof data.title === "string" ? data.title : "Pakki Baat Admin";
  const url = data.url === "/admin?tab=payments" || data.url === "/admin?tab=users" ? data.url : "/admin";
  event.waitUntil(self.registration.showNotification(title, {
    body: typeof data.body === "string" ? data.body : "",
    icon: "/admin-icon-192.png",
    badge: "/admin-icon-192.png",
    tag: typeof data.notificationTag === "string" ? data.notificationTag : "admin-alert",
    data: { url },
  }));
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  const url = event.notification.data?.url || "/admin";
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of windows) {
      if (new URL(client.url).pathname === "/admin") {
        await client.navigate(url);
        await client.focus();
        return;
      }
    }
    await self.clients.openWindow(url);
  })());
});
