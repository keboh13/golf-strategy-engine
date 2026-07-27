import { useEffect } from 'react'

// Shared hook that closes a drawer/modal when the user presses Escape.
// Extracted from CourseDetailDrawer, AdminUsersPanel, and AdminCourseEditor.

export default function useEscapeClose(onClose) {
  useEffect(() => {
    if (!onClose) return
    const handler = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])
}
