import { useEffect, useState, useCallback } from 'react'

// Captures the browser's beforeinstallprompt event so the app can show
// its own install CTA at the right moment. Also tracks online/offline
// state and service worker update availability.
export function usePwa() {
  const [deferredPrompt, setDeferredPrompt] = useState(null)
  const [isOnline, setIsOnline]   = useState(() => navigator.onLine)
  const [updateReady, setUpdateReady] = useState(false)
  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem('pwa_install_dismissed') === '1' } catch { return false }
  })

  useEffect(() => {
    const onPrompt = (e) => {
      e.preventDefault()
      setDeferredPrompt(e)
    }
    const onInstalled = () => setDeferredPrompt(null)
    const onOnline  = () => setIsOnline(true)
    const onOffline = () => setIsOnline(false)

    const onSwMessage = (e) => {
      if (e.data?.type === 'SW_UPDATED') setUpdateReady(true)
    }

    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('appinstalled',         onInstalled)
    window.addEventListener('online',               onOnline)
    window.addEventListener('offline',              onOffline)
    navigator.serviceWorker?.addEventListener('message', onSwMessage)

    // Detect waiting SW on page load (SW installed while tab was closed)
    navigator.serviceWorker?.ready.then(reg => {
      if (reg.waiting) setUpdateReady(true)
      reg.addEventListener('updatefound', () => {
        const newSw = reg.installing
        if (!newSw) return
        newSw.addEventListener('statechange', () => {
          if (newSw.state === 'installed' && navigator.serviceWorker.controller) {
            setUpdateReady(true)
          }
        })
      })
    })

    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt)
      window.removeEventListener('appinstalled',         onInstalled)
      window.removeEventListener('online',               onOnline)
      window.removeEventListener('offline',              onOffline)
      navigator.serviceWorker?.removeEventListener('message', onSwMessage)
    }
  }, [])

  const installApp = useCallback(async () => {
    if (!deferredPrompt) return
    deferredPrompt.prompt()
    const { outcome } = await deferredPrompt.userChoice
    if (outcome === 'accepted') setDeferredPrompt(null)
  }, [deferredPrompt])

  const dismiss = useCallback(() => {
    setDismissed(true)
    try { localStorage.setItem('pwa_install_dismissed', '1') } catch {}
  }, [])

  const applyUpdate = useCallback(() => {
    navigator.serviceWorker?.ready.then(reg => {
      if (reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' })
    })
    window.location.reload()
  }, [])

  return {
    canInstall: !!deferredPrompt && !dismissed,
    isOnline,
    updateReady,
    installApp,
    dismiss,
    applyUpdate,
  }
}
