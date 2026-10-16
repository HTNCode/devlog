import type { EngineInterface } from 'claude-code'

import type { Draft, Issue, Schema, TagOption } from '../types'
import { CONFIG, dataSourceUrl, isConfigured, normalizeDataSource, NOT_CONFIGURED } from './config'
import { Notice, notionError, NotionToolError } from './errors'
import { composeTitle, draftTag, isSafeName, STATUS } from './keys'
import { notionCall } from './mcp'
import type { PageSnapshot } from './parse'
import { fetchedText, parseIssues, parseJson, parsePage, parsePageStatus, parseSchema, PROP } from './parse'

const LIST_LIMIT = 100

export async function callJson($: EngineInterface, tool: string, args: Record<string, unknown>): Promise<unknown> {
  if (!isConfigured()) throw new Notice(NOT_CONFIGURED)
  return callTool($, tool, args)
}

// Reaches Notion before any DB is set: only setup, which creates that DB.
export async function callTool($: EngineInterface, tool: string, args: Record<string, unknown>): Promise<unknown> {
  const result = await notionCall($, tool, args)
  const text = result.content.find(block => block.type === 'text')?.text ?? ''
  if (result.isError) throw notionError(tool, text)
  const parsed = parseJson(text)
  return parsed === undefined ? { text } : parsed
}

// Rows mode, not SQL: SQL draws on a workspace-wide quota on non-Business
// plans, which the user's own ticket automation also needs.
export async function listOpenIssues($: EngineInterface): Promise<Issue[]> {
  const reply = await callJson($, 'notion-query-data-sources', {
    data: {
      mode: 'rows',
      data_source_url: dataSourceUrl(),
      filter: {
        type: 'group',
        operator: 'and',
        filters: [
          {
            type: 'property',
            property: PROP.status,
            propertyType: 'status',
            operator: 'status_is_not',
            value: { type: 'is_option', value: STATUS.done },
          },
        ],
      },
      sort: [{ property: PROP.end, direction: 'ascending' }],
      limit: LIST_LIMIT,
    },
  })
  return parseIssues(reply)
}

// The data source a database's fetch names in its <data-source> tag, the
// first one for a database with several. Searched in the reply as JSON,
// where the tag's quote is escaped, and from the <data-sources> list on
// when the reply has one: text above it (a description anyone may edit)
// could carry a tag of its own.
const DATA_SOURCE_TAG =
  /<data-source url=\\?"(?:\{\{)?collection:\/\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i

export function dataSourceIn(reply: unknown): string | null {
  const text = JSON.stringify(reply)
  const list = text.indexOf('<data-sources>')
  return DATA_SOURCE_TAG.exec(list === -1 ? text : text.slice(list))?.[1]?.toLowerCase() ?? null
}

// Whether this module has read the DB once: a reload starts with the id
// from settings again, which may still need resolving.
let isChecked = false

export function isDataSourceChecked(): boolean {
  return isChecked
}

function hasDataSource(reply: unknown): boolean {
  return JSON.stringify(reply).includes('data-source-state')
}

// The database a fetched data source belongs to, from the reply's own url
// field: structured, unlike the text body, where a description anyone may
// edit could plant tags of its own.
function parentDatabaseOf(reply: unknown): string | null {
  const url = typeof reply === 'object' && reply !== null ? Reflect.get(reply, 'url') : undefined
  if (typeof url !== 'string') return null
  const id = normalizeDataSource(url)
  return id === '' ? null : id
}

// A DB URL from the browser carries the database's id, not its data
// source's. Read as a database, its first data source is taken instead, for
// this module's lifetime, and only once that data source's own fetch names
// this database as its parent; settings keep what the person entered.
// Answers the verified data source's fetch, or null.
async function resolveDataSource($: EngineInterface): Promise<unknown> {
  const database = CONFIG.dataSource
  try {
    const id = dataSourceIn(await callJson($, 'notion-fetch', { id: database }))
    if (id === null || id === database) return null
    const reply = await callJson($, 'notion-fetch', { id: `collection://${id}` })
    if (parentDatabaseOf(reply) !== database || !hasDataSource(reply)) return null
    CONFIG.dataSource = id
    return reply
  } catch (error) {
    // Notion refusing either read: the id is no usable database, and the
    // first refusal says more. A failure to reach Notion is the caller's.
    if (error instanceof NotionToolError) return null
    throw error
  }
}

export async function fetchSchema($: EngineInterface): Promise<Schema> {
  const first = await callJson($, 'notion-fetch', { id: dataSourceUrl() }).catch((error: unknown) => {
    if (error instanceof NotionToolError) return error
    throw error
  })
  const reply = !(first instanceof NotionToolError) && hasDataSource(first) ? first : await resolvedReply($, first)
  isChecked = true
  return parseSchema(reply)
}

async function resolvedReply($: EngineInterface, first: unknown): Promise<unknown> {
  const resolved = await resolveDataSource($)
  if (resolved !== null) return resolved
  if (first instanceof NotionToolError) throw first
  return first
}

export async function readStatus($: EngineInterface, pageId: string): Promise<string | null> {
  return parsePageStatus(await callJson($, 'notion-fetch', { id: pageId }))
}

export async function readPage($: EngineInterface, pageId: string): Promise<PageSnapshot> {
  return parsePage(await callJson($, 'notion-fetch', { id: pageId }))
}

export async function updateStatus($: EngineInterface, pageId: string, status: string): Promise<void> {
  await callJson($, 'notion-update-page', {
    page_id: pageId,
    command: 'update_properties',
    properties: { [PROP.status]: status },
    allow_async: false,
  })
}

const COLOR = /^[a-z_]+$/

// ALTER COLUMN replaces the whole option list, and an option left out is
// also stripped from every ticket carrying it. So every existing option is
// listed again with its color, and the DDL is refused outright when the
// fresh list is empty or holds a name or color it could not quote safely.
export async function addTagOption($: EngineInterface, existing: readonly TagOption[], name: string): Promise<void> {
  const isListSafe = existing.every(option => isSafeName(option.name) && COLOR.test(option.color))
  if (existing.length === 0 || !isListSafe || !isSafeName(name)) {
    throw new Notice('案件タグの既存の選択肢を安全に引き継げないため、追加を中止しました。Notion で追加してください')
  }
  const options = [...existing, { name, color: 'default' }]
    .map(option => `'${option.name}':${option.color}`)
    .join(', ')
  const reply = await callJson($, 'notion-update-data-source', {
    data_source_id: dataSourceUrl(),
    statements: `ALTER COLUMN "${PROP.tags}" SET MULTI_SELECT(${options})`,
  })
  if (!fetchedTextIncludes(reply, name)) throw new Notice(`案件タグ「${name}」を追加できませんでした`)
}

function fetchedTextIncludes(reply: unknown, name: string): boolean {
  try {
    return fetchedText(reply).includes(name)
  } catch {
    return JSON.stringify(reply).includes(name)
  }
}

export async function createIssue($: EngineInterface, draft: Draft): Promise<void> {
  await callJson($, 'notion-create-pages', {
    parent: { type: 'data_source_id', data_source_id: CONFIG.dataSource },
    pages: [
      {
        properties: {
          [PROP.title]: composeTitle(draft),
          [PROP.status]: STATUS.todo,
          [PROP.category]: draft.category,
          [PROP.priority]: draft.priority,
          [PROP.owner]: draft.owner,
          [PROP.tags]: JSON.stringify([draftTag(draft)]),
          [`date:${PROP.start}:start`]: draft.start,
          [`date:${PROP.start}:is_datetime`]: 0,
          [`date:${PROP.end}:start`]: draft.end,
          [`date:${PROP.end}:is_datetime`]: 0,
        },
      },
    ],
    allow_async: false,
  })
}
