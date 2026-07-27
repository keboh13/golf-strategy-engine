// Golf Strategy Engine — Service Worker
// v3: proper runtime caching for Vite content-hashed assets so the app
// works fully offline. Strategy:
//   /api/*          → network-only (never cache)
//   /assets/*       → cache-first (Vite output is content-hashed, immutable)
//   everything else → network-first, stale-while-revalidate with cache fallback
//
// Update flow: new SW waits until all tabs close (no more skipWaiting),
// then notifies clients via postMessage so the app can show a refresh banner.

const CACHE_NAME = 'golf-strategy-v3'
const SHELL_ASSETS = ['/', '/index.html']

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL_ASSETS))
  )
  // Do NOT call skipWaiting — let the new SW wait until all tabs using the
  // old version are closed, preventing mixed-version asset bugs.
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
      .then(() => {
        // Notify all open tabs that a new version is active
        return self.clients.matchAll({ type: 'window' }).then(clients => {
          for (const client of clients) {
            client.postMessage({ type: 'SW_UPDATED', version: CACHE_NAME })
          }
        })
      })
  )
})

self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'SKIP_WAITING') {
    self.skipWaiting()
  }
})

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return

  const url = new URL(e.request.url)

  // API calls always go to the network; no offline cache.
  if (url.pathname.startsWith('/api/')) return

  // Vite bundles are content-hashed → cache-first, fill on miss.
  if (url.pathname.startsWith('/assets/')) {
    e.respondWith(
      caches.open(CACHE_NAME).then(cache =>
        cache.match(e.request).then(cached => {
          if (cached) return cached
          return fetch(e.request).then(res => {
            if (res.ok) cache.put(e.request, res.clone())
            return res
          })
        })
      )
    )
    return
  }

  // Shell + everything else: network-first, fall back to cache, final
  // fallback to /index.html so the SPA can hydrate from localStorage.
  e.respondWith(
    fetch(e.request)
      .then(res => {
        if (res.ok) {
          caches.open(CACHE_NAME).then(cache => cache.put(e.request, res.clone()))
        }
        return res
      })
      .catch(() =>
        caches.match(e.request)
          .then(cached => cached || caches.match('/index.html'))
      )
  )
})
