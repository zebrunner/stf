import {useEffect, useMemo, useRef, useState} from 'react'
import {Center, CloseButton, Group, Image, Loader, Modal, SegmentedControl, TextInput} from '@mantine/core'
import {useDebouncedValue} from '@mantine/hooks'
import {IconLayoutGrid, IconList, IconSearch, IconSitemap} from '@tabler/icons-react'
import {useDateFormat} from '@/core/date-format'
import {useDevices} from '@/core/devices/store'
import type {Device} from '@/core/devices/types'
import {useTranslation} from '@/core/i18n'
import {useSetting} from '@/core/settings'
import {currentUser} from '@/core/user'
import {ColumnChoice, type ColumnChoiceItem} from '@/ui/ColumnChoice'
import {basicMode} from '@/ui/modes'
import {NothingToShow} from '@/ui/NothingToShow'
import {usePageTitle} from '@/ui/page-title'
import {columnDefinition, defaultColumns, type CellContext} from './columns'
import {useDeviceActions} from './device-actions'
import {DeviceIconsView} from './DeviceIconsView'
import {DeviceStats} from './DeviceStats'
import {DeviceTable} from './DeviceTable'
import {
  defaultActiveTabs
  , defaultSort
  , deviceComparator
  , matchDevice
  , nextSort
  , normalizeColumns
  , normalizeSort
  , sortEntries
  , type ActiveTabs
} from './list-model'
import {parseQuery} from './query-parser'
import classes from './DeviceList.module.css'

type ViewMode = 'icons' | 'details'

function readStoredDeviceFilter(): string {
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

export default function DeviceListPage() {
  const {t, language} = useTranslation()
  const {devices, loading} = useDevices()
  const actions = useDeviceActions()
  const [storedColumns, setStoredColumns] = useSetting<unknown>('deviceListColumns', defaultColumns)
  const [storedSort, setStoredSort] = useSetting<unknown>('deviceListSort', defaultSort)
  const [activeTabs, setActiveTabs] = useSetting<ActiveTabs>('deviceListActiveTabs', defaultActiveTabs)
  const dateFormat = useDateFormat()
  const [search, setSearch] = useState(readStoredDeviceFilter)
  const [query] = useDebouncedValue(search, 150)
  const [photo, setPhoto] = useState<Device | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)

  usePageTitle(t('Devices'))

  const view: ViewMode = activeTabs?.details ? 'details' : 'icons'
  const columns = useMemo(() => normalizeColumns(storedColumns), [storedColumns])
  const sort = useMemo(() => normalizeSort(storedSort), [storedSort])
  const activeColumns = useMemo(
    () => columns.filter((column) => column.selected).map((column) => column.name)
    , [columns]
  )
  const terms = useMemo(() => parseQuery(query), [query])

  const filtered = useMemo(
    () => (terms.length ?
      devices.filter((device) => matchDevice(device, terms, activeColumns, language)) :
      devices)
    , [devices, terms, activeColumns, language]
  )

  const sorted = useMemo(
    () => filtered.slice().sort(deviceComparator(sortEntries(sort), language))
    , [filtered, sort, language]
  )

  const context = useMemo<CellContext>(() => ({
    actions
    , userEmail: currentUser.email
    , dateFormat
    , language
    , onImage: setPhoto
  }), [actions, dateFormat, language])

  const choiceItems = useMemo<ColumnChoiceItem[]>(() => columns.map((column) => ({
    id: column.name
    , label: t(columnDefinition(column.name)?.title || column.name)
    , selected: column.selected
  })), [columns, t])

  useEffect(() => {
    if (!basicMode) {
      searchRef.current?.focus()
    }
  }, [view])

  useEffect(() => {
    storeDeviceFilter(search)
  }, [search])

  useEffect(() => {
    const content = contentRef.current
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
  }, [])

  function reset() {
    setSearch('')
    setStoredSort(defaultSort)
    setStoredColumns(defaultColumns)
  }

  function renderContent() {
    if (loading && !devices.length) {
      return <Center py='xl'><Loader /></Center>
    }
    if (!devices.length) {
      return <NothingToShow message={t('No devices connected')} icon={<IconSitemap size={30} />} />
    }
    return (
      <>
        {view === 'details' ?
          <DeviceTable
            devices={sorted}
            columnIds={activeColumns}
            sort={sort}
            onSort={(name, multiple) => setStoredSort(nextSort(sort, name, multiple))}
            context={context}
          /> :
          <DeviceIconsView devices={sorted} actions={actions} />}
        {!filtered.length && (
          <NothingToShow message={t('No results')} icon={<IconSearch size={30} />} />
        )}
      </>
    )
  }

  return (
    <div className={`stf-device-list ${classes.page}`}>
      <div className={`unselectable ${classes.header}`}>
        <DeviceStats devices={devices} adminMode={actions.adminMode} />
        <Group gap='sm' wrap='wrap' className={classes.toolbar}>
          <TextInput
            ref={searchRef}
            name='deviceFilter'
            type='search'
            size='xs'
            className={`device-search ${classes.search}`}
            placeholder={t('Search')}
            leftSection={<IconSearch size={14} />}
            rightSection={search ? (
              <CloseButton
                size='xs'
                aria-label={t('Clear')}
                onClick={() => {
                  setSearch('')
                  searchRef.current?.focus()
                }}
              />
            ) : null}
            value={search}
            onChange={(event) => setSearch(event.currentTarget.value)}
            onFocus={(event) => event.currentTarget.select()}
            list='searchFields'
            accessKey='4'
            autoCorrect='off'
            autoCapitalize='off'
            autoComplete='off'
            spellCheck={false}
          />
          <SegmentedControl
            size='xs'
            className='device-list-active-tabs'
            value={view}
            onChange={(value) => setActiveTabs({icons: value === 'icons', details: value === 'details'})}
            data={[
              {
                value: 'icons'
                , label: (
                  <Group gap={6} wrap='nowrap'>
                    <IconLayoutGrid size={14} />
                    {!basicMode && <span>{t('Devices')}</span>}
                  </Group>
                )
              }
              , {
                value: 'details'
                , label: (
                  <Group gap={6} wrap='nowrap'>
                    <IconList size={14} />
                    {!basicMode && <span>{t('Details')}</span>}
                  </Group>
                )
              }
            ]}
          />
          {view === 'details' && (
            <ColumnChoice
              reorderable
              position='bottom-end'
              items={choiceItems}
              onChange={(items) => setStoredColumns(items.map((item) => ({name: item.id, selected: item.selected})))}
              onReset={reset}
            />
          )}
        </Group>
        <datalist id='searchFields'>
          {columns.map((column) => (
            <option key={column.name} value={`${column.name}: `}>
              {t(columnDefinition(column.name)?.title || column.name)}
            </option>
          ))}
        </datalist>
      </div>

      <div ref={contentRef} className={`selectable ${classes.content}`}>
        {renderContent()}
      </div>

      <Modal
        opened={photo !== null}
        onClose={() => setPhoto(null)}
        title={photo?.name}
        centered
        size='lg'
      >
        {photo && (
          <Image
            src={`/static/app/devices/photo/x800/${photo.image}`}
            alt={photo.name}
            fit='contain'
            mah='70vh'
          />
        )}
      </Modal>
    </div>
  )
}
