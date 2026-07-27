import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup, within } from '@testing-library/react'
import PwaBanner from './PwaBanner.jsx'

afterEach(cleanup)

const noop = () => {}
const defaults = { onInstall: noop, onDismiss: noop, onApplyUpdate: noop }

describe('PwaBanner', () => {
  it('renders nothing when online, no install, no update', () => {
    const { container } = render(
      <PwaBanner isOnline={true} canInstall={false} updateReady={false} {...defaults} />
    )
    expect(container.innerHTML).toBe('')
  })

  it('shows offline warning when not online', () => {
    const { container } = render(
      <PwaBanner isOnline={false} canInstall={false} updateReady={false} {...defaults} />
    )
    expect(within(container).getByText('Offline')).toBeTruthy()
  })

  it('shows update banner when updateReady and online', () => {
    const { container } = render(
      <PwaBanner isOnline={true} canInstall={false} updateReady={true} {...defaults} />
    )
    expect(within(container).getByText('A new version is available.')).toBeTruthy()
    expect(within(container).getByText('Refresh')).toBeTruthy()
  })

  it('shows install CTA when canInstall and online', () => {
    const { container } = render(
      <PwaBanner isOnline={true} canInstall={true} updateReady={false} {...defaults} />
    )
    expect(within(container).getByText('Add to Home Screen')).toBeTruthy()
    expect(within(container).getByText('Install')).toBeTruthy()
  })

  it('shows offline warning and update banner together when offline with update', () => {
    const { container } = render(
      <PwaBanner isOnline={false} canInstall={false} updateReady={true} {...defaults} />
    )
    expect(within(container).getByText('Offline')).toBeTruthy()
  })
})
