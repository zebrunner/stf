// Fork (Zebrunner): the sign-in form explains the sign-in limit of lib/util/ratelimit.ts
import {fireEvent, render, screen} from '@testing-library/react'
import {MantineProvider} from '@mantine/core'
import {afterEach, beforeAll, describe, expect, it, vi} from 'vitest'
import {SignInForm} from './SignInForm'

beforeAll(() => {
  // jsdom has no matchMedia, Mantine asks for the color scheme with it
  window.matchMedia = window.matchMedia || ((query: string) => ({
    matches: false
    , media: query
    , onchange: null
    , addListener: () => {}
    , removeListener: () => {}
    , addEventListener: () => {}
    , removeEventListener: () => {}
    , dispatchEvent: () => false
  }))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('SignInForm (Zebrunner)', () => {
  it('tells a locked out user to wait (429)', async() => {
    vi.stubGlobal('fetch', vi.fn((url: string) => Promise.resolve(url.includes('/auth/contact') ?
      new Response(JSON.stringify({contact: {email: 'admin@example.com'}})) :
      new Response(JSON.stringify({success: false, error: 'TooManyRequestsError', retryAfter: 180}), {
        status: 429
      }))))
    const {container} = render(
      <MantineProvider>
        <SignInForm mode='ldap' />
      </MantineProvider>
    )
    fireEvent.change(container.querySelector('input[name=username]')!, {target: {value: 'mallory'}})
    fireEvent.change(container.querySelector('input[name=password]')!, {target: {value: 'guess'}})
    fireEvent.submit(container.querySelector('form')!)
    expect(await screen.findByText('Too many failed sign-ins. Try again in a few minutes.')).toBeTruthy()
  })
})
