import { useSyncExternalStore } from 'react'
import { getSyncState, subscribeSync, type SyncState } from '@/sync/manager'
import { intentsSnapshot, subscribeIntents } from '@/intents/config'
import { canInstall, subscribeInstall } from '@/native/platform'

export const useSync = (): SyncState => useSyncExternalStore(subscribeSync, getSyncState)

// Re-render when the intents config or activity log changes.
export const useIntentsVersion = (): string => useSyncExternalStore(subscribeIntents, intentsSnapshot)

export const useCanInstall = (): boolean => useSyncExternalStore(subscribeInstall, canInstall)
