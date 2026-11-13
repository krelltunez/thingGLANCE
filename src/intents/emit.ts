// OUTBOUND: turn a horizon event into a dayGLANCE task.
//
// "AppleCare+ ends Mar 3" is information; "decide about AppleCare+ by Feb 24"
// is a task, and tasks live in dayGLANCE. The create intent carries
// source_app + source_entity_id (the horizon event key), so dayGLANCE can
// dedupe a re-send and report back when the task is completed
// (src/intents/receive.ts closes the loop).
//
// Everything on the vault is encrypted (the zero-knowledge contract the
// sibling apps enforce on receive), so there is no plaintext path here.

import { ACTIONS, buildEncryptedEnvelope, deriveEnvelopeKey } from '@glance-apps/intents'
import dayjs from 'dayjs'
import type { HorizonEvent, Thing } from '@/core/types'
import { DAY, fmtDay, today } from '@/core/dates'
import { decide } from '@/db/queries'
import { SOURCE_APP, addActivity, getIntentsConfig, isIntentsEnabled } from './config'
import { loadIntentsRootKey } from './keyStore'
import { sendEnvelope } from './transport'

export class IntentsUnavailableError extends Error {
  constructor(readonly reason: 'disabled' | 'no-key') {
    super(reason === 'disabled' ? 'Intents are turned off' : 'The intents encryption key is not set up on this device')
    this.name = 'IntentsUnavailableError'
  }
}

const VERBS: Record<HorizonEvent['type'], (e: HorizonEvent) => string> = {
  'coverage-end': (e) => `Use or extend coverage: ${e.detail}`,
  'support-end': (e) => `Plan a replacement for ${e.detail}`,
  replace: (e) => `Shop for a new ${e.detail}`,
  renewal: (e) => `Keep or cancel ${e.title.replace(/ renews$/, '')}?`,
  'trial-end': (e) => `Cancel or keep ${e.title.replace(/ trial converts$/, '')} trial`,
  'sub-end': (e) => `Renew ${e.title.replace(/ (expires|access ends)$/, '')}?`,
}

export function taskFor(event: HorizonEvent, leadDays: number): { title: string; due: string; notes: string } {
  // Due `leadDays` before the event, but never in the past.
  const target = dayjs(event.date).subtract(leadDays, 'day').format(DAY)
  const due = target < today() ? today() : target
  return {
    title: VERBS[event.type](event),
    due,
    notes: `${event.title} on ${fmtDay(event.date)} (${event.detail}). Sent from thingGLANCE.`,
  }
}

export async function sendEventToDayglance(event: HorizonEvent, thing?: Thing | null): Promise<void> {
  if (!isIntentsEnabled()) throw new IntentsUnavailableError('disabled')
  const rootKey = await loadIntentsRootKey()
  if (!rootKey) throw new IntentsUnavailableError('no-key')
  const task = taskFor(event, getIntentsConfig().leadDays)
  const owners = thing?.ownerIds ?? []
  try {
    const envelope = await buildEncryptedEnvelope(
      {
        action: ACTIONS.CREATE,
        emittedBy: SOURCE_APP,
        payload: {
          title: task.title,
          due: task.due,
          all_day: true,
          notes: task.notes,
          source_app: SOURCE_APP,
          source_entity_id: event.key,
          ...(owners.length > 0 && { assigned_user_ids: owners }),
        },
      },
      (salt) => deriveEnvelopeKey(rootKey, salt),
    )
    await sendEnvelope(envelope)
    await decide(event.key, 'sent')
    addActivity({ type: 'sent', message: `Sent "${task.title}" to dayGLANCE`, detail: `Due ${fmtDay(task.due)}` })
  } catch (err) {
    addActivity({ type: 'error', message: `Could not send "${task.title}" to dayGLANCE`, detail: err instanceof Error ? err.message : String(err) })
    throw err
  }
}
