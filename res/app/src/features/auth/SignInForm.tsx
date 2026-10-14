import {useState, type FormEvent} from 'react'
import {
  Alert
  , Anchor
  , Box
  , Button
  , Center
  , Group
  , Image
  , Paper
  , PasswordInput
  , Stack
  , Text
  , TextInput
  , Title
  , Tooltip
} from '@mantine/core'
import {IconAlertCircle, IconLock, IconMail, IconUser} from '@tabler/icons-react'
import {api, ApiError} from '@/core/api'
import {useContactEmail} from '@/core/contact'
import {useTranslation} from '@/core/i18n'
import classes from './SignInForm.module.css'

type Mode = 'mock' | 'ldap' | 'zebrunner'

type SignInError = 'invalid' | 'incorrect' | 'server' | null

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function usernameLabel(mode: Mode): string {
  if (mode === 'mock') {
    return 'Name'
  }
  if (mode === 'zebrunner') {
    return 'Username or email'
  }
  return 'LDAP Username'
}

function usernameRequiredMessage(mode: Mode): string {
  if (mode === 'mock') {
    return 'Please enter your name'
  }
  if (mode === 'zebrunner') {
    return 'Please enter your username or email'
  }
  return 'Please enter your LDAP username'
}

export function SignInForm({mode}: {mode: Mode}) {
  const {t} = useTranslation()
  const [username, setUsername] = useState('')
  const [secret, setSecret] = useState('')
  const [touched, setTouched] = useState({username: false, secret: false})
  const [error, setError] = useState<SignInError>(null)
  const [submitting, setSubmitting] = useState(false)
  const contactEmail = useContactEmail()

  const userLabel = usernameLabel(mode)
  const usernameError = touched.username && !username ? t(usernameRequiredMessage(mode)) : null

  let secretError: string | null = null
  if (touched.secret) {
    if (!secret) {
      secretError = t(mode === 'mock' ? 'Please enter your email' : 'Please enter your password')
    }
    else if (mode === 'mock' && !emailPattern.test(secret)) {
      secretError = t('Please enter a valid email')
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    setTouched({username: true, secret: true})
    if (!username || !secret || (mode === 'mock' && !emailPattern.test(secret))) {
      setError('invalid')
      return
    }
    setSubmitting(true)
    const body = mode === 'mock' ?
      {name: username, email: secret} :
      {username, password: secret}
    try {
      const response = await api.post<{redirect: string}>(`/auth/api/v1/${mode}`, body)
      setError(null)
      window.location.replace(response.redirect)
    }
    catch (caught) {
      const code = caught instanceof ApiError ? caught.data?.error : null
      if (code === 'ValidationError') {
        setError('invalid')
      }
      else if (code === 'InvalidCredentialsError') {
        setError('incorrect')
      }
      else {
        setError('server')
      }
      setSubmitting(false)
    }
  }

  const errorText = {
    invalid: t('Check errors below')
    , incorrect: mode === 'zebrunner' ?
      t('Invalid credentials or user has been deactivated') : t('Incorrect login details')
    , server: t('Server error. Check log output.')
  }

  return (
    <Center className={classes.page}>
      <Paper className={classes.card} shadow='xl' p='xl' withBorder>
        <Stack align='center' gap='xs' mb='lg'>
          <Image src='/static/logo/exports/STF-512.png' w={88} h={88} alt='STF' />
          <Title order={2}>{t('Smartphone Test Farm')}</Title>
          <Text c='dimmed' size='sm'>
            {mode === 'ldap' ? t('Sign in with your LDAP account') : t('Sign in to continue')}
          </Text>
        </Stack>
        <form name='signin' noValidate onSubmit={submit}>
          <Stack>
            {error && (
              <Alert color='red' variant='light' icon={<IconAlertCircle size={18} />}
                className='alert alert-danger'>
                {errorText[error]}
              </Alert>
            )}
            <TextInput
              name='username'
              label={t(userLabel)}
              placeholder={t(userLabel)}
              leftSection={<IconUser size={16} />}
              value={username}
              onChange={(event) => setUsername(event.currentTarget.value)}
              onBlur={() => setTouched((state) => ({...state, username: true}))}
              error={usernameError}
              autoComplete='section-login username'
              autoCapitalize='off'
              autoCorrect='off'
              spellCheck={false}
              required
              size='md'
            />
            {mode === 'mock' ?
              <TextInput
                name='email'
                type='email'
                label={t('E-mail')}
                placeholder={t('E-mail')}
                leftSection={<IconMail size={16} />}
                value={secret}
                onChange={(event) => setSecret(event.currentTarget.value)}
                onBlur={() => setTouched((state) => ({...state, secret: true}))}
                error={secretError}
                autoComplete='section-login email'
                autoCapitalize='off'
                autoCorrect='off'
                spellCheck={false}
                required
                size='md'
              /> :
              <PasswordInput
                name='password'
                label={t('Password')}
                placeholder={t('Password')}
                leftSection={<IconLock size={16} />}
                value={secret}
                onChange={(event) => setSecret(event.currentTarget.value)}
                onBlur={() => setTouched((state) => ({...state, secret: true}))}
                error={secretError}
                autoComplete='section-login current-password'
                required
                size='md'
              />}
            <Button type='submit' size='md' variant='filled' fullWidth loading={submitting}>
              {t('Log In')}
            </Button>
          </Stack>
        </form>
        <Box mt='lg'>
          <Group justify='center'>
            {contactEmail ?
              <Tooltip label={t('Write a mail to the support team')}>
                <Anchor href={`mailto:${contactEmail}`} size='sm' c='dimmed'>
                  {t('Contact Support')}
                </Anchor>
              </Tooltip> :
              <Text size='sm' c='dimmed'>{t('Contact Support')}</Text>}
          </Group>
        </Box>
      </Paper>
    </Center>
  )
}
