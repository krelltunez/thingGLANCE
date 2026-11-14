// JSON backup: the escape hatch for an app whose only sync road is the vault.

import { db } from './client'
import type { Coverage, Decision, DeviceLink, Member, Subscription, Thing } from '@/core/types'
import { normalizeSubscription, normalizeThing } from '@/core/shape'
import { tr } from '@/core/text'
import { markDirty } from '@/sync/dirtyTracker'
import { markRosterDirty } from '@/multiuser/rosterDirtyTracker'

export const BACKUP_FORMAT = 'thingglance-backup'
// 2: the household shape (members, devices, one owner per thing). Version 1
// files still import: their rows go through the shape readers.
export const BACKUP_VERSION = 2

export interface Backup {
  format: typeof BACKUP_FORMAT
  version: number
  exportedAt: string
  appVersion: string
  things: Thing[]
  coverages: Coverage[]
  subscriptions: Subscription[]
  decisions: Decision[]
  members: Member[]
  devices: DeviceLink[]
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
    members: await db.members.toArray(),
    devices: await db.devices.toArray(),
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
  // `users` is what version 1 called the roster.
  const data = JSON.parse(text) as Partial<Backup> & { users?: Member[] }
  if (data.format !== BACKUP_FORMAT) throw new Error(tr('backup.notABackup'))
  if ((data.version ?? 0) > BACKUP_VERSION) throw new Error(tr('backup.tooNew'))
  let added = 0
  let updated = 0
  const merge = async <T extends { id: string; updatedAt: string }>(
    table: { get: (id: string) => Promise<T | undefined>; put: (row: T) => Promise<unknown> },
    rows: T[] | undefined,
    mark: (id: string) => void,
    read: (row: T) => T = (row) => row,
  ) => {
    for (const row of rows ?? []) {
      if (!row?.id || !row.updatedAt) continue
      const cur = await table.get(row.id)
      if (cur && cur.updatedAt >= row.updatedAt) continue
      await table.put(read(row))
      mark(row.id)
      if (cur) updated++
      else added++
    }
  }
  await merge(db.things, data.things, markDirty, normalizeThing)
  await merge(db.coverages, data.coverages, markDirty)
  await merge(db.subscriptions, data.subscriptions, markDirty, normalizeSubscription)
  await merge(db.decisions, data.decisions, markDirty)
  await merge(db.devices, data.devices, markDirty)
  await merge(db.members, data.members ?? data.users, markRosterDirty)
  return { added, updated }
}

export async function wipeLocalData(): Promise<void> {
  await db.transaction('rw', [db.things, db.coverages, db.subscriptions, db.decisions, db.members, db.devices, db.tombstones], async () => {
    await Promise.all([db.things.clear(), db.coverages.clear(), db.subscriptions.clear(), db.decisions.clear(), db.members.clear(), db.devices.clear(), db.tombstones.clear()])
  })
}
