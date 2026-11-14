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
import { tr } from '@/core/text'
import { decide } from '@/db/queries'
import { SOURCE_APP, addActivity, getIntentsConfig, isIntentsEnabled } from './config'
import { loadIntentsRootKey } from './keyStore'
import { sendEnvelope } from './transport'

export class IntentsUnavailableError extends Error {
  constructor(readonly reason: 'disabled' | 'no-key') {
    super(reason === 'disabled' ? tr('intents.off') : tr('intents.noKey'))
    this.name = 'IntentsUnavailableError'
  }
}

// What the task asks for. `thing` is the thing the date is about; `name` is
// the plan's own name (an event carries it apart from its title, which
// already has it inside a sentence).
const taskTitle = (e: HorizonEvent): string => tr(`intents.task.${e.type}`, { thing: e.detail, name: e.name ?? e.title })

export function taskFor(event: HorizonEvent, leadDays: number): { title: string; due: string; notes: string } {
  // Due `leadDays` before the event, but never in the past.
  const target = dayjs(event.date).subtract(leadDays, 'day').format(DAY)
  const due = target < today() ? today() : target
  return {
    title: taskTitle(event),
    due,
    notes: tr('intents.task.notes', { title: event.title, date: fmtDay(event.date), detail: event.detail }),
  }
}

export async function sendEventToDayglance(event: HorizonEvent, thing?: Thing | null): Promise<void> {
  if (!isIntentsEnabled()) throw new IntentsUnavailableError('disabled')
  const rootKey = await loadIntentsRootKey()
  if (!rootKey) throw new IntentsUnavailableError('no-key')
  const task = taskFor(event, getIntentsConfig().leadDays)
  // The task goes to whoever deals with the thing; failing that, its owner.
  const assignee = thing?.responsibleMemberId ?? thing?.ownerMemberId ?? null
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
          ...(assignee && { assigned_user_ids: [assignee] }),
        },
      },
      (salt) => deriveEnvelopeKey(rootKey, salt),
    )
    await sendEnvelope(envelope)
    await decide(event.key, 'sent')
    addActivity({ type: 'sent', message: tr('intents.activity.sent', { title: task.title }), detail: tr('intents.activity.due', { date: fmtDay(task.due) }) })
  } catch (err) {
    addActivity({ type: 'error', message: tr('intents.activity.sendFailed', { title: task.title }), detail: err instanceof Error ? err.message : String(err) })
    throw err
  }
}
