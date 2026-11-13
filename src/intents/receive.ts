// INBOUND: dayGLANCE reports back on tasks thingGLANCE created. A `notify`
// whose source_app is ours and whose source_entity_id is a horizon event key
// closes the loop: completed -> the decision becomes 'done' and the item
// leaves the attention queue on every device; deleted/uncompleted -> it comes
// back.

import {
  EVENTS, MalformedEnvelopeError, deriveEnvelopeKey, parseEncryptedEnvelope,
} from '@glance-apps/intents'
import type { Envelope, IntentEventRow } from '@glance-apps/intents'
import { getSyncPassphrase } from '@glance-apps/sync'
import { decide, undecide } from '@/db/queries'
import {
  SOURCE_APP, addActivity, clearReceiveFailure, getIntentsConfig, getReceiveCursor,
  isIntentsEnabled, recordReceiveFailure, setReceiveCursor,
} from './config'
import { loadIntentsRootKey } from './keyStore'
import { setupIntentsEncryption } from './setup'
import { MAX_INTENT_RETRIES, listIntentsPage, receiveAllIntents } from './transport'

class KeyNotAvailableError extends Error {}

export async function handleEnvelope(envelope: Envelope): Promise<void> {
  if (envelope.action !== 'notify') return
  const p = envelope.payload
  if (p.source_app !== SOURCE_APP) return // someone else's task
  const key = p.source_entity_id
  switch (p.event) {
    case EVENTS.COMPLETED:
      await decide(key, 'done', p.task_id)
      addActivity({ type: 'received', message: `"${p.title}" was completed in dayGLANCE` })
      break
    case EVENTS.UNCOMPLETED:
      await decide(key, 'sent', p.task_id)
      addActivity({ type: 'received', message: `"${p.title}" was reopened in dayGLANCE` })
      break
    case EVENTS.DELETED:
      await undecide(key)
      addActivity({ type: 'received', message: `"${p.title}" was deleted in dayGLANCE` })
      break
    default:
      // rescheduled / updated: the task still exists; remember its id.
      await decide(key, 'sent', p.task_id)
  }
}

async function processRow(row: IntentEventRow): Promise<void> {
  const data = row.envelope as Record<string, unknown> | null
  if (!data || data.encrypted !== true) {
    // Plaintext on the vault is a contract violation: never route it.
    addActivity({ type: 'error', message: `Rejected non-encrypted intent ${row.eventId}` })
    return
  }
  const rootKey = await loadIntentsRootKey()
  if (!rootKey) throw new KeyNotAvailableError(row.eventId) // transient: hold and retry
  let envelope: Envelope
  try {
    envelope = await parseEncryptedEnvelope(data, (salt) => deriveEnvelopeKey(rootKey, salt))
  } catch (err) {
    // Key present but the row will not decrypt: terminal, advance past it.
    // Quiet for malformed rows; other apps' traffic is not our problem to report.
    if (!(err instanceof MalformedEnvelopeError)) {
      addActivity({ type: 'warning', message: `Could not decrypt intent ${row.eventId}`, detail: err instanceof Error ? err.message : String(err) })
    }
    return
  }
  await handleEnvelope(envelope)
}

let draining = false

async function poll(): Promise<void> {
  if (!isIntentsEnabled() || draining) return
  draining = true
  try {
    // Silent self-heal: the enabled flag lives in localStorage, the key in
    // IndexedDB, and browsers evict the latter. Re-derive when the passphrase
    // happens to be in memory; never prompt from a poll.
    if (!(await loadIntentsRootKey())) {
      const pass = getSyncPassphrase()
      if (pass) await setupIntentsEncryption(pass).catch(() => {})
    }
    await receiveAllIntents({
      getCursor: getReceiveCursor,
      setCursor: setReceiveCursor,
      listPage: listIntentsPage,
      processRow,
      recordFailure: recordReceiveFailure,
      clearFailure: clearReceiveFailure,
      onGiveUp: (row, err, failures) => addActivity({
        type: 'error',
        message: `Dropped intent ${row.eventId} after ${failures} attempts (limit ${MAX_INTENT_RETRIES})`,
        detail: err instanceof KeyNotAvailableError
          ? 'No intents encryption key on this device. Re-enter your sync passphrase in Settings.'
          : err instanceof Error ? err.message : String(err),
      }),
    })
  } catch (err) {
    addActivity({ type: 'error', message: 'Could not check GLANCEvault for intents', detail: err instanceof Error ? err.message : String(err) })
  } finally {
    draining = false
  }
}

export function drainIntents(): void {
  void poll()
}

let pollerStarted = false

// Once on start, on focus, and on an interval: the sibling apps' cadence.
export function startIntentsPoller(): void {
  if (pollerStarted) return
  pollerStarted = true
  void poll()
  setInterval(() => void poll(), getIntentsConfig().pollIntervalMinutes * 60 * 1000)
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void poll() })
}
