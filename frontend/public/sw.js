// Service worker mínimo: permite instalar el sistema en el celular y recibir archivos compartidos
// desde otras apps (WhatsApp, Archivos, Galería). No guarda páginas en caché: el sistema siempre se ve actualizado.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method === "POST" && url.pathname === "/compartir") {
    event.respondWith((async () => {
      try {
        const datos = await event.request.formData();
        const archivos = datos.getAll("archivos").filter((f) => f && typeof f === "object" && f.size);
        const cache = await caches.open("compartidos");
        let n = 0;
        for (const f of archivos) {
          n += 1;
          await cache.put(new Request(`/compartido/${Date.now()}-${n}`), new Response(f, {
            headers: { "Content-Type": f.type || "application/octet-stream", "X-Nombre": encodeURIComponent(f.name || `documento-${n}`) },
          }));
        }
      } catch { /* sin archivos */ }
      return Response.redirect("/?compartido=1", 303);
    })());
  }
  // Todo lo demás va directo a la red
});
