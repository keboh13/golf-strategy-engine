import { useEffect, useState, useCallback } from 'react'

// Captures the browser's beforeinstallprompt event so the app can show
// its own install CTA at the right moment. Also tracks online/offline state.
//
// Returns:
//   canInstall  boolean — browser is ready to prompt for install
//   isOnline    boolean — navigator.onLine, reactive
//   installApp  () => Promise<void> — triggers the native install dialog
//   dismiss     () => void — hides the install banner until next mount
export function usePwa() {
  const [deferredPrompt, setDeferredPrompt] = useState(null)
  const [isOnline, setIsOnline]   = useState(() => navigator.onLine)
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

    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('appinstalled',         onInstalled)
    window.addEventListener('online',               onOnline)
    window.addEventListener('offline',              onOffline)
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt)
      window.removeEventListener('appinstalled',         onInstalled)
      window.removeEventListener('online',               onOnline)
      window.removeEventListener('offline',              onOffline)
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

  return {
    canInstall: !!deferredPrompt && !dismissed,
    isOnline,
    installApp,
    dismiss,
  }
}
