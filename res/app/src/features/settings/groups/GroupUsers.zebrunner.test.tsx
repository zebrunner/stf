// Fork (Zebrunner): the owner of a group adds a user by its email, a user who is not an admin sees the users of its
// groups only (GET /api/v1/users)
import {cleanup, fireEvent, render, screen, waitFor} from '@testing-library/react'
import {MantineProvider} from '@mantine/core'
import {ModalsProvider} from '@mantine/modals'
import {afterEach, beforeAll, describe, expect, it, vi} from 'vitest'
import type {Group} from '@/core/groups-api'
import {GroupUsers} from './GroupUsers'
import {useGroupsStore} from './store'

beforeAll(() => {
  // jsdom has no matchMedia and ResizeObserver, Mantine uses them
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
  window.ResizeObserver = window.ResizeObserver || class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const group = {
  id: 'g1'
  , name: 'Team'
  , owner: {email: 'alice@example.com', name: 'alice'}
  , users: ['alice@example.com']
} as unknown as Group

function renderUsers() {
  useGroupsStore.setState({
    users: {'alice@example.com': {value: {email: 'alice@example.com', name: 'alice', privilege: 'user'}, timeStamp: -1}}
  } as never)
  const result = render(
    <MantineProvider>
      <ModalsProvider>
        <GroupUsers group={group} />
      </ModalsProvider>
    </MantineProvider>
  )
  fireEvent.click(screen.getByText('Available users'))
  return result
}

describe('GroupUsers (Zebrunner)', () => {
  it('adds a user by its email, then lists the users of the groups again', async() => {
    const fetch = vi.fn((url: string) => Promise.resolve(new Response(JSON.stringify(url.startsWith('/api/v1/users') ?
      {success: true, users: [{email: 'bob@example.com', name: 'bob', privilege: 'user'}]} :
      {success: true, group: {}}))))
    vi.stubGlobal('fetch', fetch)
    const {container} = renderUsers()
    const input = await screen.findByLabelText('Add a user by email')
    const add = container.querySelector('.group-add-user-email button[type=submit]') as HTMLButtonElement
    expect(add.disabled).toBe(true)
    fireEvent.change(input, {target: {value: 'not an email'}})
    expect(add.disabled).toBe(true)
    fireEvent.change(input, {target: {value: ' bob@example.com '}})
    expect(add.disabled).toBe(false)
    fireEvent.click(add)
    await waitFor(() => expect(fetch.mock.calls.length).toBe(2))
    expect(fetch.mock.calls[0]![0]).toBe('/api/v1/groups/g1/users/bob@example.com')
    expect((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].method).toBe('PUT')
    expect(fetch.mock.calls[1]![0]).toMatch(/^\/api\/v1\/users\?fields=/)
    await waitFor(() => expect((input as HTMLInputElement).value).toBe(''))
    expect(useGroupsStore.getState().users['bob@example.com']?.value?.email).toBe('bob@example.com')
  })

  it('keeps the email of a user the API refused', async() => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(
      JSON.stringify({success: false, description: 'Not Found (group user)'}), {status: 404}))))
    const {container} = renderUsers()
    const input = await screen.findByLabelText('Add a user by email')
    fireEvent.change(input, {target: {value: 'nobody@example.com'}})
    fireEvent.click(container.querySelector('.group-add-user-email button[type=submit]')!)
    expect(await screen.findByText('Not Found (group user)')).toBeTruthy()
    expect((input as HTMLInputElement).value).toBe('nobody@example.com')
  })
})
