// JSON backup: the escape hatch for an app whose only sync road is the vault.

import { db } from './client'
import type { Coverage, Decision, Subscription, Thing, User } from '@/core/types'
import { markDirty } from '@/sync/dirtyTracker'
import { markRosterDirty } from '@/multiuser/rosterDirtyTracker'

export const BACKUP_FORMAT = 'thingglance-backup'
export const BACKUP_VERSION = 1

export interface Backup {
  format: typeof BACKUP_FORMAT
  version: number
  exportedAt: string
  appVersion: string
  things: Thing[]
  coverages: Coverage[]
  subscriptions: Subscription[]
  decisions: Decision[]
  users: User[]
}

export async function buildBackup(): Promise<Backup> {
  const strip = <T extends { sample?: boolean }>(rows: T[]) => rows.filter((r) => !r.sample)
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    appVersion: __APP_VERSION__,
    things: strip(await db.things.toArray()),
    coverages: strip(await db.coverages.toArray()),
    subscriptions: strip(await db.subscriptions.toArray()),
    decisions: await db.decisions.toArray(),
    users: await db.users.toArray(),
  }
}

export async function downloadBackup(): Promise<void> {
  const backup = await buildBackup()
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `thingglance-backup-${backup.exportedAt.slice(0, 10)}.json`
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// Merge by id, newest updatedAt wins: importing an old backup never rolls a
// row back, and importing twice changes nothing.
export async function importBackup(text: string): Promise<{ added: number; updated: number }> {
  const data = JSON.parse(text) as Partial<Backup>
  if (data.format !== BACKUP_FORMAT) throw new Error('This file is not a thingGLANCE backup.')
  if ((data.version ?? 0) > BACKUP_VERSION) throw new Error('This backup was made by a newer version of thingGLANCE.')
  let added = 0
  let updated = 0
  const merge = async <T extends { id: string; updatedAt: string }>(
    table: { get: (id: string) => Promise<T | undefined>; put: (row: T) => Promise<unknown> },
    rows: T[] | undefined,
    mark: (id: string) => void,
  ) => {
    for (const row of rows ?? []) {
      if (!row?.id || !row.updatedAt) continue
      const cur = await table.get(row.id)
      if (cur && cur.updatedAt >= row.updatedAt) continue
      await table.put(row)
      mark(row.id)
      if (cur) updated++
      else added++
    }
  }
  await merge(db.things, data.things, markDirty)
  await merge(db.coverages, data.coverages, markDirty)
  await merge(db.subscriptions, data.subscriptions, markDirty)
  await merge(db.decisions, data.decisions, markDirty)
  await merge(db.users, data.users, markRosterDirty)
  return { added, updated }
}

export async function wipeLocalData(): Promise<void> {
  await db.transaction('rw', [db.things, db.coverages, db.subscriptions, db.decisions, db.users, db.tombstones], async () => {
    await Promise.all([db.things.clear(), db.coverages.clear(), db.subscriptions.clear(), db.decisions.clear(), db.users.clear(), db.tombstones.clear()])
  })
}
