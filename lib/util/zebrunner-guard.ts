// Fork (Zebrunner): a malformed message of ZeroMQ or of the WebSocket of a client must not end
// the unit. The listeners run in process.nextTick (zeromq compat, socket.io), so an exception of
// one was uncaught: the unit exited and every client of it was disconnected; anyone who could send
// such a message could stop the unit again and again.

// the logger of the unit (lib/util/logger.ts)
export interface Log {
  error(...args: unknown[]): void
}

// the same failure is logged once in this period, the others are counted: a client may repeat
// it on purpose
var REPORT_PERIOD_MS = 60 * 1000
var MAX_REPORTED_FAILURES = 1000

interface Reported {
  at: number
  dropped: number
}

var reported = new Map<string, Reported>()

function describe(err: unknown): string {
  if (err instanceof Error) {
    return err.stack || err.message
  }
  return String(err)
}

/**
 * Logs the failure (with its stack: it may be a bug of STF) once in a while per what failed and
 * why; the detail (e.g. the client) is logged, it does not make another failure.
 */
export function reportDropped(
  log: Log
, what: string
, err: unknown
, detail?: string
, now = Date.now()
) {
  var reason = err instanceof Error ? err.message : String(err)
  var key = what + '\u0000' + reason
  var last = reported.get(key)
  if (last && now - last.at < REPORT_PERIOD_MS) {
    last.dropped++
    return
  }
  if (!last && reported.size >= MAX_REPORTED_FAILURES) {
    reported.clear()
  }
  var dropped = last ? last.dropped : 0
  reported.set(key, {at: now, dropped: 0})
  log.error(
    'Dropped %s%s%s: %s'
  , what
  , detail ? ` (${detail})` : ''
  , dropped ? ` and ${dropped} more of the same in the last minute` : ''
  , describe(err)
  )
}

export function resetReported() {
  reported.clear()
}

/**
 * The listener with its exceptions and the rejections of its promise reported instead of thrown.
 */
export function guardListener<A extends unknown[]>(
  log: Log
, what: string
, listener: (...args: A) => unknown
, detail?: (...args: A) => string
): (...args: A) => unknown {
  return function(this: unknown, ...args: A) {
    var report = function(err: unknown) {
      var text: string | null = null
      try {
        text = detail ? detail(...args) : null
      }
      catch {
        text = null
      }
      reportDropped(log, what, err, text || '')
    }
    try {
      var result = listener.apply(this, args)
      if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
        (result as PromiseLike<unknown>).then(null, report)
      }
      return result
    }
    catch (err) {
      report(err)
      return null
    }
  }
}

interface ListenerTarget {
  on(event: string, listener: (...args: any[]) => unknown): unknown
}

/**
 * Every listener the code adds to the socket of a client afterwards is guarded (guardListener).
 */
export function guardSocket<S extends ListenerTarget>(
  log: Log
, socket: S
, client: () => string
): S {
  var on = socket.on
  socket.on = function(this: S, event: string, listener: (...args: any[]) => unknown) {
    var guarded = guardListener(log, `the "${event}" event of a client`, listener, client)
    return on.call(this, event, guarded)
  } as S['on']
  return socket
}
