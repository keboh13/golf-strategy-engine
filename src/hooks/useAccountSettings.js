import { useState } from 'react'

// Hook for account-management state (password change, email change, delete
// account). These six useState vars are only consumed by SettingsTab, so
// extracting them here keeps App.jsx leaner.

export default function useAccountSettings() {
  const [acctSection,     setAcctSection]     = useState(null)  // null | 'password' | 'email' | 'delete'
  const [acctNewPass,     setAcctNewPass]     = useState('')
  const [acctConfirmPass, setAcctConfirmPass] = useState('')
  const [acctNewEmail,    setAcctNewEmail]    = useState('')
  const [acctMsg,         setAcctMsg]         = useState(null)  // { type: 'ok'|'err', text }
  const [acctLoading,     setAcctLoading]     = useState(false)

  return {
    acctSection, setAcctSection,
    acctNewPass, setAcctNewPass,
    acctConfirmPass, setAcctConfirmPass,
    acctNewEmail, setAcctNewEmail,
    acctMsg, setAcctMsg,
    acctLoading, setAcctLoading,
  }
}
