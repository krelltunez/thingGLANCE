// Automation apps on Android (Tasker, MacroDroid, Automate), from the web side.
//
// Another app on the phone sends a broadcast; the native side queues it as an
// outside write and the app applies it through dispatchExternalWrite(), on
// screen or in a background refresh (native/widgetBridge.ts collects the
// queue; docs/tasker.md has the actions). So nothing is handled here. What is
// left is the switch: the receiver is open to every app on the phone, so it
// does nothing until the user turns it on, and the native side keeps the
// switch so it holds with the app not running.

import { registerPlugin } from '@capacitor/core'

interface AutomationPlugin {
  get(): Promise<{ enabled: boolean }>
  set(options: { enabled: boolean }): Promise<{ enabled: boolean }>
}

const Automation = registerPlugin<AutomationPlugin>('Automation')

// Off when it cannot be read: the safe answer.
export async function automationEnabled(): Promise<boolean> {
  try {
    return (await Automation.get()).enabled === true
  } catch {
    return false
  }
}

// Answers what the switch is now.
export async function setAutomationEnabled(enabled: boolean): Promise<boolean> {
  try {
    return (await Automation.set({ enabled })).enabled === true
  } catch {
    return false
  }
}
