// Reminders on Android, from the web side.
//
// Which dates notify, when and on whose device is decided in
// src/core/reminders.ts and travels in the snapshot. The scheduling itself is
// native (android: reminders/ReminderScheduler.kt): the snapshot is handed
// over with the widget payload (native/widgetBridge.ts) and Android's alarms
// are made to match its `reminders`, whoever brings it, the app on screen or
// a background refresh with no screen at all.
//
// So nothing is scheduled from here. What is left is the one thing that needs
// the app on screen: Android's permission prompt.

import { registerPlugin } from '@capacitor/core'
import type { Reminder } from '@/core/reminders'

export type NotifyPermission = 'granted' | 'denied' | 'prompt'

interface RemindersPlugin {
  permission(): Promise<{ state: NotifyPermission }>
  requestPermission(): Promise<{ state: NotifyPermission }>
  // What Android has been asked to deliver: a JSON array of reminders.
  pending(): Promise<{ reminders: string }>
}

export const Reminders = registerPlugin<RemindersPlugin>('Reminders')

// Asked once, at the first moment there is something to remind about.
const ASKED_KEY = 'tg_notify_asked'

export async function notifyPermission(): Promise<NotifyPermission> {
  try {
    return (await Reminders.permission()).state
  } catch {
    return 'denied'
  }
}

// Shows the system's own prompt (Android 13+; older versions need none).
export async function requestNotifyPermission(): Promise<boolean> {
  try { localStorage.setItem(ASKED_KEY, '1') } catch { /* asked this session */ }
  try {
    return (await Reminders.requestPermission()).state === 'granted'
  } catch {
    return false
  }
}

// Called with each new plan. The alarms are already set by the native side;
// this only asks for permission the first time there is something to show,
// which is the moment the question makes sense to the person answering it.
export async function askOnceIfNeeded(planned: Reminder[]): Promise<void> {
  if (!planned.length) return
  let asked = true
  try { asked = localStorage.getItem(ASKED_KEY) === '1' } catch { /* treat as asked */ }
  if (asked) return
  if ((await notifyPermission()) === 'prompt') await requestNotifyPermission()
}
