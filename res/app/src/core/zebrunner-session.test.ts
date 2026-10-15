// Fork (Zebrunner): the logout ends the session on the server
import {afterEach, describe, expect, it, vi} from 'vitest'
import {endSession} from './zebrunner-session'

describe('endSession (Zebrunner)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('posts the logout of the app unit', async() => {
    const fetch = vi.fn(() => Promise.resolve(new Response('{"success":true}')))
    vi.stubGlobal('fetch', fetch)
    await endSession()
    expect(fetch).toHaveBeenCalledWith('/app/api/v1/logout', expect.objectContaining({method: 'POST'}))
  })

  it('lets the logout go on when the server cannot be reached', async() => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))))
    await expect(endSession()).resolves.toBeUndefined()
  })
})
