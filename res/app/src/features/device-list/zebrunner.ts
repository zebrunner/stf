// Fork (Zebrunner): the device list remembers its filter and its scroll position, and keeps its
// view tabs on phones (basic mode)
import {useEffect, type RefObject} from 'react'
import {basicMode} from '@/ui/modes'

export const viewTabsInBasicMode = true

export function readStoredDeviceFilter(): string {
  try {
    const direct = window.localStorage.getItem('deviceFilter')
    if (direct) {
      return direct
    }
    const legacy = window.localStorage.getItem('deviceFilters')
    const filters = legacy ? JSON.parse(legacy) : null
    const filter = Array.isArray(filters) ? filters[0] : null
    if (filter && typeof filter === 'object') {
      const field = typeof filter.field === 'string' ? `${filter.field}: ` : ''
      const query = typeof filter.query === 'string' ? filter.query : ''
      return `${field}${query}`.trim()
    }
  }
  catch {
    return ''
  }
  return ''
}

function storeDeviceFilter(value: string): void {
  try {
    if (value) {
      window.localStorage.setItem('deviceFilter', value)
    }
    else {
      window.localStorage.removeItem('deviceFilter')
      window.localStorage.setItem('deviceFilters', JSON.stringify([]))
    }
  }
  catch {
    // localStorage can be disabled or full; filtering must still work.
  }
}

export function useStoredDeviceFilter(search: string): void {
  useEffect(() => {
    storeDeviceFilter(search)
  }, [search])
}

export function useStoredScrollPosition(ref: RefObject<HTMLDivElement | null>): void {
  useEffect(() => {
    const content = ref.current
    if (!content || basicMode) {
      content?.scrollTo(0, 0)
      return undefined
    }
    const stored = window.localStorage.getItem('scrollPosition')
    if (stored) {
      content.scrollTo(0, Number(stored))
    }
    function saveScroll() {
      window.localStorage.setItem('scrollPosition', String(content!.scrollTop))
    }
    content.addEventListener('scroll', saveScroll, {passive: true})
    return () => content.removeEventListener('scroll', saveScroll)
  }, [ref])
}
