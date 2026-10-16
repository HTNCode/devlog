import type { EngineInterface, McpToolResult, On } from 'claude-code'

import { CONFIG, saveOption } from './config'
import { Notice } from './errors'
import { getNotionServers, setLoad, setNotionServers, setPending } from './state'

const MCP_PREFIX = 'mcp__'
const NOTION_FETCH = /^mcp__.+__notion-fetch$/
const FETCH_SUFFIX = '__notion-fetch'

export const NO_NOTION =
  'このセッションでは Notion のコネクタにつながりません。/mcp で接続を確認してください。名前が違うときは、ペインに出る候補から接続先を追加するか、/config の notion-backlog の server にカンマ区切りで足してください'

// The listed server a call last reached. The module's own: a reload asks again.
let connected: string | null = null

function isNotConnected(error: unknown): boolean {
  return error instanceof Error && error.message.includes('no connected MCP tool')
}

// mcp__<server>__<tool>: the server part is a spelling $.mcp.call accepts.
function serverOf(toolName: string, suffix: string): string {
  return toolName.slice(MCP_PREFIX.length, -suffix.length)
}

async function note($: EngineInterface, servers: readonly string[]): Promise<void> {
  await setNotionServers($, known => [...new Set([...known, ...servers])])
}

// The desktop app names the connector by an id of its own. A server with a
// Notion-shaped tool is only noted as a candidate the person may add: any
// connected server could expose a tool by that name, so none is called
// until settings list it. Tools behind ToolSearch are missing from
// $.tool.list but are each described once as the session starts; $.state
// keeps the note across a reload, which raises no description again.
export function registerMcp(on: On): void {
  on('tool.describe', { tool: NOTION_FETCH }, async ($, e, next) => {
    await note($, [serverOf(e.tool, FETCH_SUFFIX)])
    return next(e)
  })
}

// Always by notion-fetch, whichever call failed: every Notion connector has
// it, and a setup's failed create must still find the same candidates.
async function noteListed($: EngineInterface): Promise<void> {
  const tools = await $.tool.list()
  await note($, tools
    .filter(one => one.mcp && NOTION_FETCH.test(one.name))
    .map(one => serverOf(one.name, FETCH_SUFFIX)))
}

async function tryServer($: EngineInterface, server: string, tool: string, args: Record<string, unknown>) {
  try {
    const result = await $.mcp.call(server, tool, args)
    connected = server
    return result
  } catch (error) {
    if (isNotConnected(error)) return null
    throw error
  }
}

// Reads every Notion connector has; a read may be tried on the next listed
// server, a write never is.
const READ_TOOLS: ReadonlySet<string> = new Set(['notion-fetch', 'notion-query-data-sources', 'notion-get-file-download-urls'])
// A read with no side effect, used to settle which server to write to.
const PROBE_ARGS = { id: 'notion://docs/enhanced-markdown-spec' }

// The first listed server that answers the read settles the connection.
async function reach($: EngineInterface, tool: string, args: Record<string, unknown>): Promise<McpToolResult> {
  for (const server of CONFIG.servers) {
    const result = await tryServer($, server, tool, args)
    if (result !== null) return result
  }
  await noteListed($)
  throw new Notice(NO_NOTION)
}

// Once a server is reached, every call stays on it: the same refusal means
// a server gone and a tool it lacks alike, and a write must never land on
// another listed server's workspace because the first lacked the tool. A
// write before any read settles the server with a probe read first.
export async function notionCall($: EngineInterface, tool: string, args: Record<string, unknown>): Promise<McpToolResult> {
  if (connected === null || !CONFIG.servers.includes(connected)) {
    if (READ_TOOLS.has(tool)) return reach($, tool, args)
    await reach($, 'notion-fetch', PROBE_ARGS)
  }
  const server = connected ?? ''
  const result = await tryServer($, server, tool, args)
  if (result !== null) return result
  throw new Notice(`接続先「${server}」で ${tool} を使えません。/mcp で接続を確かめてください`)
}

// A server name as tool names carry it (claude.ai Notion -> claude_ai_Notion),
// so a listed server is recognised in either spelling.
function spelling(name: string): string {
  return name.replace(/[^A-Za-z0-9_-]/g, '_')
}

export async function serverCandidates($: EngineInterface): Promise<string[]> {
  const listed = new Set(CONFIG.servers.map(spelling))
  return (await getNotionServers($)).filter(name => !listed.has(spelling(name)))
}

// Saving the server list reloads this module, so the confirm flags are
// cleared first and the save is the last step.
export async function confirmServer($: EngineInterface, name: string): Promise<void> {
  await setPending($, () => null)
  await setLoad($, l => ({ ...l, isWriting: false }))
  // A save that throws ends like a refused one: the toast says what to do.
  const isSaved = await saveOption($, 'server', [...CONFIG.servers, name].join(', ')).catch(() => false)
  if (!isSaved) $.ui.toast(`接続先を保存できませんでした。/config の notion-backlog の server に ${name} を足してください`)
}
