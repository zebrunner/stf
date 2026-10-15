// Fork (Zebrunner): ends the session of the user on the server (lib/util/authsession.ts), the
// cookie of the session is not readable by scripts any more
import {api} from './api'

export function endSession(): Promise<void> {
  return api.post('/app/api/v1/logout').then(() => undefined, () => undefined)
}
