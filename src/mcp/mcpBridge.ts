// The MCP request bridge, the page's half (docs/mcp.md): the main process's
// MCP server asks, this answers from the database, and only this window is
// listened to (electron/mcpRendererBridge.ts). A request is answered whether
// or not the window is on screen.
//
// Every request gets an answer, an error included: a request left hanging
// reads to the assistant as "the app is not there".

import type { DesktopBridge } from '@/native/desktop'
import { readData } from './readData'
import { handleRead } from './readModel'
import { handleWrite } from './writeModel'

interface McpRequest { id: number; method: string; params?: Record<string, unknown> }

const isRequest = (v: unknown): v is McpRequest =>
  !!v && typeof v === 'object' && typeof (v as McpRequest).id === 'number' && typeof (v as McpRequest).method === 'string'

export async function answerMcpRequest(method: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  try {
    const read = handleRead(await readData(), method, params)
    if (read) return read
    const write = await handleWrite(method, params)
    if (write) return write
    return { ok: false, error: { code: 'unknown_method', message: `thingGLANCE does not answer "${method}".` } }
  } catch {
    return { ok: false, error: { code: 'internal', message: 'thingGLANCE could not answer.' } }
  }
}

export function startMcpBridge(bridge: Pick<DesktopBridge, 'mcp'>): () => void {
  return bridge.mcp.onRequest((raw) => {
    if (!isRequest(raw)) return
    const params = raw.params && typeof raw.params === 'object' ? raw.params : {}
    void answerMcpRequest(raw.method, params).then((answer) => bridge.mcp.respond({ id: raw.id, ...answer }))
  })
}
