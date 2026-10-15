import {useEffect, useState} from 'react'
import {api} from './api'

export function useContactEmail(): string | null {
  const [email, setEmail] = useState<string | null>('support@zebrunner.com')

  useEffect(() => {
    api.get<{contact: {email: string}}>('/auth/contact')
      .then((response) => setEmail(response.contact.email || 'support@zebrunner.com'))
      .catch(() => undefined)
  }, [])

  return email
}
