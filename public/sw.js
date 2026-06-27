// Golf Strategy Engine — Service Worker
// v2: proper runtime caching for Vite content-hashed assets so the app
// works fully offline. Strategy:
//   /api/*          → network-only (never cache)
//   /assets/*       → cache-first (Vite output is content-hashed, immutable)
//   everything else → network-first, stale-while-revalidate with cache fallback

const CACHE_NAME = 'golf-strategy-v2'
const SHELL_ASSETS = ['/', '/index.html']

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL_ASSETS))
  )
  self.skipWaiting()
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  )
  self.clients.claim()
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
