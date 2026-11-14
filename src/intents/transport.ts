// App-owned vault transport for intents. @glance-apps/intents is a codec, not
// a transport: it encodes and decodes rows; delivery (HTTP, auth, pagination,
// the cursor) lives here. Same server contract as lastGLANCE's
// src/intents/dbTransport.ts:
//   POST {vault}/intents/batch  { accountId, events: [{ eventId, envelope, expiresAt }] }
//   GET  {vault}/intents/list?accountId=&since=&limit=   -> { rows, hasMore }

import { netFetch } from '@/sync/shellFetch'
import { buildIntentRow, parseIntentRow } from '@glance-apps/intents'
import type { EncryptedEnvelope, Envelope, IntentEventRow } from '@glance-apps/intents'
import { getVaultConfig } from '@/sync/vaultConfig'
import { tr } from '@/core/text'
import { getIntentsConfig } from './config'

const LIST_LIMIT = 500
const TIMEOUT_MS = 15_000
export const MAX_INTENT_RETRIES = 5

interface Conn { vaultUrl: string; vaultToken: string; accountId: string }

function conn(): Conn | null {
  const v = getVaultConfig()
  return v && v.vaultUrl && v.vaultToken && v.accountId ? { vaultUrl: v.vaultUrl, vaultToken: v.vaultToken, accountId: v.accountId } : null
}

async function vaultFetch(c: Conn, method: string, path: string, opts: { query?: Record<string, string>; body?: unknown } = {}): Promise<Response> {
  let url = c.vaultUrl.replace(/\/+$/, '') + path
  if (opts.query) url += `?${new URLSearchParams(opts.query)}`
  const headers: Record<string, string> = { Authorization: `Bearer ${c.vaultToken}` }
  const body = opts.body !== undefined ? JSON.stringify(opts.body) : undefined
  if (body) headers['Content-Type'] = 'application/json'
  return netFetch(url, { method, headers, body, signal: AbortSignal.timeout(TIMEOUT_MS) })
}

// Insert-only: re-sending a row whose eventId exists is a server no-op, so a
// retried send is always safe. The row carries no seq, so sending can never
// move the receive cursor.
export async function sendEnvelope(envelope: Envelope | EncryptedEnvelope): Promise<void> {
  const c = conn()
  if (!c) throw new Error(tr('intents.notConnected'))
  const row = buildIntentRow(envelope, { ttlMs: getIntentsConfig().ttlMs })
  const res = await vaultFetch(c, 'POST', '/intents/batch', { body: { accountId: c.accountId, events: [row] } })
  if (!res.ok) throw new Error(`intents batch failed: ${res.status}`)
}

export interface ListPage { rows: IntentEventRow[]; hasMore: boolean }

export async function listIntentsPage(since: number): Promise<ListPage | null> {
  const c = conn()
  if (!c) return null
  const res = await vaultFetch(c, 'GET', '/intents/list', { query: { accountId: c.accountId, since: String(since), limit: String(LIST_LIMIT) } })
  if (!res.ok) throw new Error(`intents list failed: ${res.status}`)
  const data = (await res.json()) as { rows: unknown[]; hasMore: boolean }
  return { rows: data.rows.map((r) => parseIntentRow(r)), hasMore: data.hasMore === true }
}

export interface ReceiveDeps {
  getCursor: () => number | null
  setCursor: (seq: number) => void
  listPage: (since: number) => Promise<ListPage | null>
  // Returns on success or on a permanently bad row (skip-logged inside);
  // THROWS only on a transient failure, which holds the cursor for a retry.
  processRow: (row: IntentEventRow) => Promise<void>
  recordFailure: (seq: number) => number
  clearFailure: (seq: number) => void
  onGiveUp?: (row: IntentEventRow, err: unknown, failures: number) => void
}

// Paginated drain with bounded retry (the sibling apps' three-way model): a
// row that returns advances the cursor; a row that throws stops the drain to
// be retried next poll; a row that has thrown MAX_INTENT_RETRIES times is
// given up on so one poison row cannot wedge the channel.
export async function receiveAllIntents(deps: ReceiveDeps): Promise<number> {
  let cursor = deps.getCursor() ?? 0
  let processed = 0
  for (;;) {
    const page = await deps.listPage(cursor)
    if (!page) break
    for (const row of page.rows) {
      try {
        await deps.processRow(row)
      } catch (err) {
        const failures = deps.recordFailure(row.seq)
        if (failures < MAX_INTENT_RETRIES) return processed
        deps.onGiveUp?.(row, err, failures)
      }
      deps.clearFailure(row.seq)
      cursor = row.seq
      deps.setCursor(cursor)
      processed++
    }
    if (!page.hasMore) break
  }
  return processed
}
