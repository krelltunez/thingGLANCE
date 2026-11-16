// Everything the MCP models read, fresh from the database for each request
// (docs/mcp.md). Read here and not from React state, so a hidden window
// answers as well as a visible one. Privacy is applied at the door, as
// everywhere else: `data` is what this device's member may see.

import { today } from '@/core/dates'
import { memberOfDevice, userIds, visibleTo } from '@/core/household'
import { buildSnapshot } from '@/core/snapshot'
import type { DataSet } from '@/core/types'
import { db } from '@/db/client'
import { getSettings } from '@/state/settings'
import { getDeviceId } from '@/sync/deviceId'
import type { ReadData } from './readModel'

export async function readData(): Promise<ReadData> {
  const [things, coverages, subscriptions, decisions, members, devices] = await Promise.all([
    db.things.toArray(), db.coverages.toArray(), db.subscriptions.toArray(), db.decisions.toArray(), db.members.toArray(), db.devices.toArray(),
  ])
  const all: DataSet = { things, coverages, subscriptions, decisions }
  const meId = memberOfDevice(devices, getDeviceId(), members)
  const users = userIds(devices, members)
  const settings = getSettings()
  return {
    all,
    data: visibleTo(all, meId),
    members,
    meId,
    users,
    snapshot: buildSnapshot(all, { viewerId: meId, userIds: users, currency: settings.currency, reminderPrefs: settings.reminders }),
    today: today(),
  }
}
