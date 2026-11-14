// The record of writes that came in from outside the app and were applied.
//
// Automation double-fires, a widget tap is retried when the app was asleep,
// the launcher keeps a durable outbox and re-sends until it sees its write
// land. So every outside write carries an id its caller chose, and a write
// whose id is already here is acknowledged without being applied again.
// lastGLANCE's launcher ledger is the model (src/intents/launcherWrites.ts).

export const LEDGER_KEY = 'tg_handled_writes'
export const LEDGER_LIMIT = 500

export interface HandledWrite {
  clientId: string
  action: string
  // What the write made or changed, when it has one.
  entityId: string | null
  // Anything else the first answer carried that a repeat should carry too
  // (the state a decision was left in).
  extra?: Record<string, string>
  at: string
}

type Store = { getItem(key: string): string | null; setItem(key: string, value: string): void }
const defaultStore = (): Store | undefined => (typeof localStorage === 'undefined' ? undefined : localStorage)

export function readLedger(store: Store | undefined = defaultStore()): HandledWrite[] {
  try {
    const parsed: unknown = JSON.parse(store?.getItem(LEDGER_KEY) ?? '[]')
    return Array.isArray(parsed) ? (parsed as HandledWrite[]).filter((h) => h && typeof h.clientId === 'string') : []
  } catch {
    return []
  }
}

export function writeLedger(ledger: HandledWrite[], store: Store | undefined = defaultStore()): void {
  try {
    store?.setItem(LEDGER_KEY, JSON.stringify(ledger))
  } catch {
    // Storage full or unavailable: creates still dedupe on their own id.
  }
}

export const findHandled = (ledger: HandledWrite[], clientId: string): HandledWrite | null => ledger.find((h) => h.clientId === clientId) ?? null

// The ledger with one more entry, newest last, bounded so it stays small.
export function recordHandled(ledger: HandledWrite[], entry: HandledWrite): HandledWrite[] {
  const next = ledger.filter((h) => h.clientId !== entry.clientId)
  next.push(entry)
  return next.length > LEDGER_LIMIT ? next.slice(next.length - LEDGER_LIMIT) : next
}
