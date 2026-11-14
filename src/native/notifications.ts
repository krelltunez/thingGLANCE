// Android notifications for the reminder plan.
//
// Which dates notify, when and on whose device is decided in
// src/core/reminders.ts and travels in the snapshot. This module only makes
// what Android has pending match that plan: schedule what is new or changed,
// cancel what is gone (diffReminders). It decides nothing itself.
//
// Alarms are inexact on purpose. "Your warranty ends in a week" does not need
// to arrive to the second, and exact alarms are a special permission on
// Android 12+ that Play restricts to alarm clocks and calendars.

import { LocalNotifications } from '@capacitor/local-notifications'
import { diffReminders, reminderNumericId, reminderSignature, type Reminder } from '@/core/reminders'
import { tr } from '@/core/text'
import i18n from '@/i18n'
import { dispatchExternalWrite } from '@/intents/inbound'
import { getSettings } from '@/state/settings'
import { openLink } from './links'

const CHANNEL = 'dates'
const ACTION_TYPE = 'tg-date'
const ACTION_DONE = 'done'
// Asked once, at the first moment there is something to remind about.
const ASKED_KEY = 'tg_notify_asked'

interface Extra { link?: string; eventKey?: string; reminderId?: string; sig?: string }

export type NotifyPermission = 'granted' | 'denied' | 'prompt'

export async function notifyPermission(): Promise<NotifyPermission> {
  try {
    const { display } = await LocalNotifications.checkPermissions()
    return display === 'granted' ? 'granted' : display === 'denied' ? 'denied' : 'prompt'
  } catch {
    return 'denied'
  }
}

// Shows the system's own prompt (Android 13+; older versions need none).
export async function requestNotifyPermission(): Promise<boolean> {
  try { localStorage.setItem(ASKED_KEY, '1') } catch { /* asked this session */ }
  try {
    return (await LocalNotifications.requestPermissions()).display === 'granted'
  } catch {
    return false
  }
}

// The channel's name and the action's label are shown by Android, so they
// are registered again whenever the app's language changes.
async function describe(): Promise<void> {
  await LocalNotifications.createChannel({ id: CHANNEL, name: tr('notify.channel'), description: tr('notify.channelDescription'), importance: 3 }).catch(() => {})
  await LocalNotifications.registerActionTypes({ types: [{ id: ACTION_TYPE, actions: [{ id: ACTION_DONE, title: tr('notify.done') }] }] }).catch(() => {})
}

let running: Promise<void> = Promise.resolve()

// Makes Android's pending notifications match `wanted`. Calls are queued, so
// two plans arriving together cannot interleave their cancels and schedules.
export function syncReminders(wanted: Reminder[]): Promise<void> {
  running = running.then(() => apply(wanted)).catch(() => {})
  return running
}

async function apply(wanted: Reminder[]): Promise<void> {
  if (!getSettings().reminders.enabled) wanted = []
  let permission = await notifyPermission()
  let asked = true
  try { asked = localStorage.getItem(ASKED_KEY) === '1' } catch { /* treat as asked */ }
  if (permission === 'prompt' && wanted.length > 0 && !asked) permission = (await requestNotifyPermission()) ? 'granted' : 'denied'
  // Without permission nothing would be shown; leave nothing scheduled either.
  if (permission !== 'granted') wanted = []

  const pending = (await LocalNotifications.getPending()).notifications
  const { schedule, cancel } = diffReminders(wanted, pending.map((n) => ({ id: n.id, signature: (n.extra as Extra | undefined)?.sig })))
  if (cancel.length) await LocalNotifications.cancel({ notifications: cancel.map((id) => ({ id })) })
  if (!schedule.length) return
  await LocalNotifications.schedule({
    notifications: schedule.map((r) => ({
      id: reminderNumericId(r.id),
      title: r.title,
      body: r.body,
      channelId: CHANNEL,
      actionTypeId: ACTION_TYPE,
      isExactNotification: false,
      schedule: { at: new Date(r.at), allowWhileIdle: true },
      extra: { link: r.link, eventKey: r.eventKey, reminderId: r.id, sig: reminderSignature(r) } satisfies Extra,
    })),
  })
}

// A tap opens the date. "Done with this" clears it, through the one door
// writes from outside come in by; its id is the reminder's, so a tap that is
// delivered twice clears once.
function listen(): void {
  void LocalNotifications.addListener('localNotificationActionPerformed', ({ actionId, notification }) => {
    const extra = (notification.extra ?? {}) as Extra
    if (actionId === ACTION_DONE && extra.eventKey) {
      void dispatchExternalWrite({ action: 'decide', payload: { event_key: extra.eventKey, state: 'done' }, clientId: `notification:${extra.reminderId ?? extra.eventKey}:done` })
      return
    }
    if (extra.link) openLink(extra.link)
  })
}

export function startNotifications(): void {
  listen()
  void describe()
  i18n.on('languageChanged', () => void describe())
}
