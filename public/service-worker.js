/* Run-Site service worker.
   Goals:
   - Let the app shell load offline on spotty job sites.
   - Never serve stale code while online.
   - Never white-screen from a shell that references an evicted/missing bundle.

   Strategy:
   - /static/* are content-hashed and immutable -> CACHE-FIRST (once fetched they
     never change, so they're always available offline and can't 404).
   - Everything else (incl. index.html / navigations) -> NETWORK-FIRST with a
     cache fallback when offline.
   - Never cache API calls. */

const CACHE = 'run-site-v2'

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  if (url.pathname.startsWith('/api/')) return

  // Immutable hashed build assets: cache-first.
  if (url.pathname.startsWith('/static/')) {
    event.respondWith(
      caches.match(request).then((cached) =>
        cached || fetch(request).then((response) => {
          if (response && response.status === 200) {
            const copy = response.clone()
            caches.open(CACHE).then((cache) => cache.put(request, copy))
          }
          return response
        })
      )
    )
    return
  }

  // Everything else: network-first, fall back to cache when offline.
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response && response.status === 200 && response.type === 'basic') {
          const copy = response.clone()
          caches.open(CACHE).then((cache) => cache.put(request, copy))
        }
        return response
      })
      .catch(async () => {
        const cached = await caches.match(request)
        if (cached) return cached
        if (request.mode === 'navigate') {
          const shell = await caches.match('/index.html')
          if (shell) return shell
        }
        throw new Error('Offline and not cached')
      })
  )
})
