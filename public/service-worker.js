/* Run-Site service worker — conservative network-first caching.
   Goal: let the app shell load when offline (workers on job sites with
   spotty signal) without ever serving stale code while online.

   Strategy:
   - Network-first for everything. If the network succeeds, use it and
     refresh the cache. If it fails (offline), fall back to the cache.
   - Never cache API calls (Supabase, our /api functions, Anthropic, etc.)
     so clock data and receipts always go straight to the network. */

const CACHE = 'run-site-v1'

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

  // Only handle same-origin requests; let API/cross-origin go to network.
  if (url.origin !== self.location.origin) return
  if (url.pathname.startsWith('/api/')) return

  event.respondWith(
    fetch(request)
      .then((response) => {
        // Cache a copy of successful basic responses for offline fallback.
        if (response && response.status === 200 && response.type === 'basic') {
          const copy = response.clone()
          caches.open(CACHE).then((cache) => cache.put(request, copy))
        }
        return response
      })
      .catch(async () => {
        const cached = await caches.match(request)
        if (cached) return cached
        // For navigations, fall back to the cached app shell.
        if (request.mode === 'navigate') {
          const shell = await caches.match('/index.html')
          if (shell) return shell
        }
        throw new Error('Offline and not cached')
      })
  )
})
