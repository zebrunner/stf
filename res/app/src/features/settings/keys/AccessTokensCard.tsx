import {useState, type FormEvent} from 'react'
import {Link} from 'react-router'
import {
  ActionIcon
  , Alert
  , Button
  , Center
  , Collapse
  , Group
  , Loader
  , NumberInput
  , Text
  , Textarea
  , TextInput
  , ThemeIcon
  , Tooltip
} from '@mantine/core'
import {useQuery, useQueryClient} from '@tanstack/react-query'
import {IconAlertTriangle, IconCheck, IconHelpCircle, IconKey, IconPlus, IconTrash} from '@tabler/icons-react'
import {api} from '@/core/api'
import {useTranslation} from '@/core/i18n'
import {emit, useSocketEvent} from '@/core/socket'
import {CopyButton} from '@/ui/CopyButton'
import {errorMessage} from '@/ui/modals'
import {NothingToShow} from '@/ui/NothingToShow'
import {WidgetCard} from '@/ui/WidgetCard'
import classes from './Keys.module.css'

interface GeneratedToken {
  title: string
  tokenId: string
  expiresAt?: string | null
}

// Fork (Zebrunner): the title and the expiry of every token (never its secret, STF keeps its hash only)
interface AccessTokenInfo {
  title: string
  expiresAt?: string | null
}

const accessTokensQueryKey = ['user', 'accessTokens']
const DAY_SECONDS = 24 * 60 * 60
const MAX_TTL_DAYS = 3650

function fetchAccessTokens(): Promise<AccessTokenInfo[]> {
  return api.get<{tokens?: AccessTokenInfo[]}>('/api/v1/user/fullAccessTokens')
    .then((response) => response.tokens || [])
}

function isExpired(expiresAt?: string | null): boolean {
  return Boolean(expiresAt) && new Date(expiresAt!).getTime() <= Date.now()
}

function ExpiryText({expiresAt}: {expiresAt?: string | null | undefined}) {
  const {t} = useTranslation()
  if (!expiresAt) {
    return <Text size='xs' c='dimmed'>{t('Does not expire')}</Text>
  }
  const date = new Date(expiresAt).toLocaleString()
  return isExpired(expiresAt) ?
    <Text size='xs' c='red'>{t('Expired {{date}}', {date})}</Text> :
    <Text size='xs' c='dimmed'>{t('Expires {{date}}', {date})}</Text>
}

function GenerateAccessTokenForm({onClose}: {onClose: () => void}) {
  const {t} = useTranslation()
  const [title, setTitle] = useState('')
  // Fork (Zebrunner): the optional lifetime of the token in days, empty: no expiry
  const [days, setDays] = useState<number | string>('')

  function close() {
    setTitle('')
    setDays('')
    onClose()
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    const ttl = typeof days === 'number' && days > 0 ? days * DAY_SECONDS : null
    emit('user.keys.accessToken.generate', {title, ttl})
    close()
  }

  return (
    <form className={`stf-generate-access-token ${classes.panel}`} name='generateAccessTokenForm' onSubmit={submit}>
      <Text fw={600} size='sm' mb='sm'>{t('Generate Access Token')}</Text>
      <TextInput
        id='access-token-title'
        name='accessTokenTitle'
        label={t('Title')}
        leftSection={<IconKey size={16} />}
        required
        value={title}
        onChange={(event) => setTitle(event.currentTarget.value)}
        onFocus={(event) => event.currentTarget.select()}
      />
      <NumberInput
        id='access-token-ttl-days'
        name='accessTokenTtlDays'
        label={t('Expires in (days)')}
        description={t('Empty: the token does not expire')}
        mt='xs'
        min={1}
        max={MAX_TTL_DAYS}
        allowDecimal={false}
        allowNegative={false}
        value={days}
        onChange={setDays}
      />
      <Group justify='flex-end' gap='xs' mt='sm'>
        <Button variant='default' size='xs' onClick={close}>{t('Cancel')}</Button>
        <Button type='submit' size='xs' variant='filled' leftSection={<IconPlus size={14} />}>{t('Generate New Token')}</Button>
      </Group>
    </form>
  )
}

function GeneratedTokenNotice({token, onClose}: {token: GeneratedToken, onClose: () => void}) {
  const {t} = useTranslation()

  return (
    <Alert
      variant='light'
      color='yellow'
      icon={<IconAlertTriangle size={18} />}
      className='access-token-generated selectable'
      mb='sm'
    >
      <Text size='sm'>
        <Text span fw={600} size='sm'>{t('Warning:')}</Text>
        {' '}
        {t("Make sure to copy your access token now. You won't be able to see it again.")}
      </Text>
      <Group gap='xs' mt='xs' wrap='nowrap' align='center'>
        <Textarea
          readOnly
          autosize
          minRows={1}
          value={token.tokenId}
          aria-label={token.title}
          className={`token-id-textarea ${classes.mono}`}
          onFocus={(event) => event.currentTarget.select()}
          style={{flex: 1}}
        />
        <CopyButton value={token.tokenId} variant='light' size='lg' className='access-token-copy' />
        <Button
          size='xs'
          variant='filled'
          leftSection={<IconCheck size={14} />}
          className='access-token-generated-okay'
          onClick={onClose}
        >
          {t('OK')}
        </Button>
      </Group>
      <ExpiryText expiresAt={token.expiresAt} />
    </Alert>
  )
}

export function AccessTokensCard() {
  const {t} = useTranslation()
  const queryClient = useQueryClient()
  const [showGenerate, setShowGenerate] = useState(false)
  const [generated, setGenerated] = useState<GeneratedToken | null>(null)
  const tokens = useQuery({
    queryKey: accessTokensQueryKey
    , queryFn: fetchAccessTokens
    , staleTime: 0
  })
  const list = tokens.data || []

  function refresh() {
    queryClient.invalidateQueries({queryKey: accessTokensQueryKey}).catch(() => undefined)
  }

  useSocketEvent('user.keys.accessToken.generated', (token: GeneratedToken) => {
    setGenerated(token)
    refresh()
  })
  useSocketEvent('user.keys.accessToken.updated', refresh)

  return (
    <WidgetCard
      className='stf-keys stf-access-tokens'
      icon={IconKey}
      title={t('Access Tokens')}
      actions={(
        <>
          <Tooltip label={t('More about Access Tokens')} withArrow>
            <ActionIcon
              component={Link}
              to='/docs/Access-Tokens'
              variant='subtle'
              color='gray'
              size='lg'
              aria-label={t('More about Access Tokens')}
            >
              <IconHelpCircle size={18} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label={t('Generate Access Token')} withArrow>
            <ActionIcon
              className='stf-generate-access-token-toggle'
              variant={showGenerate ? 'filled' : 'light'}
              size='lg'
              aria-label={t('Generate Access Token')}
              aria-pressed={showGenerate}
              onClick={() => setShowGenerate(!showGenerate)}
            >
              <IconPlus size={18} />
            </ActionIcon>
          </Tooltip>
        </>
      )}
    >
      <Collapse expanded={showGenerate}>
        <GenerateAccessTokenForm onClose={() => setShowGenerate(false)} />
      </Collapse>
      {generated && (
        <GeneratedTokenNotice
          token={generated}
          onClose={() => {
            setGenerated(null)
            refresh()
          }}
        />
      )}
      {tokens.isPending && <Center py='lg'><Loader size='sm' /></Center>}
      {tokens.isError && (
        <Alert variant='light' color='red' p='xs'>{errorMessage(tokens.error)}</Alert>
      )}
      {tokens.isSuccess && !list.length && !showGenerate && !generated && (
        <NothingToShow icon={<IconKey size={30} />} message={t('No access tokens')} />
      )}
      {list.length > 0 && (
        <ul className={`key-list ${classes.list}`}>
          {list.map(({title, expiresAt}, index) => (
            <li key={`${index}-${title}`} className={classes.item}>
              <ThemeIcon variant='light' color='gray' size={36} radius='md'>
                <IconKey size={18} />
              </ThemeIcon>
              <div className={`key-list-details selectable ${classes.itemDetails}`}>
                <Text className='key-list-title' fw={500} size='sm' truncate>{title}</Text>
                <ExpiryText expiresAt={expiresAt} />
              </div>
              <Button
                className='key-list-remove'
                size='xs'
                variant='light'
                color='red'
                leftSection={<IconTrash size={14} />}
                onClick={() => emit('user.keys.accessToken.remove', {title})}
              >
                {t('Remove')}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </WidgetCard>
  )
}
