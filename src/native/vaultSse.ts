// The native reader for the vault's live event stream (Android today).
//
// The WebView cannot read that stream: requests go out on a native stack that
// hands back whole responses, and this one never ends. So the shell holds the
// connection (android: sse/VaultSseClient.kt) and passes each event block in
// as an `sseMessage` plugin event. The message shapes are the sibling apps':
//   {type:'open'}                    connected (again)
//   {type:'frame', block:'…'}        one raw event block
//   {type:'closed'}                  dropped; the reader will reconnect
//   {type:'error', message, code?}   with a code it has stopped for good
//                                    ('auth', 'insecure', 'unsupported')
//
// Like the web reader it only ever makes the app sync sooner. Polling carries
// on underneath.

import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core'
import type { ShellEventStream } from './shell'

interface VaultSsePlugin {
  start(options: { vaultUrl: string; vaultToken: string; accountId: string }): Promise<void>
  stop(): Promise<void>
  addListener(eventName: 'sseMessage', listener: (msg: unknown) => void): Promise<PluginListenerHandle>
}

const VaultSse = registerPlugin<VaultSsePlugin>('VaultSse')

// Null on a shell built before the reader existed: the app keeps polling.
export function nativeEventStream(): ShellEventStream | null {
  if (!Capacitor.isNativePlatform() || !Capacitor.isPluginAvailable('VaultSse')) return null
  return {
    start: (connection) => VaultSse.start(connection),
    stop: () => VaultSse.stop(),
    listen: (listener) => {
      // Capacitor hands the handle back later; an unsubscribe that comes first
      // removes it on arrival.
      let handle: PluginListenerHandle | undefined
      let removed = false
      void VaultSse.addListener('sseMessage', listener).then((h) => {
        if (removed) void h.remove()
        else handle = h
      })
      return () => { removed = true; void handle?.remove() }
    },
  }
}
