import type { EngineInterface } from 'claude-code'

import type { Draft, Issue, Schema, TagOption } from '../types'
import { CONFIG, dataSourceUrl, isConfigured, NOT_CONFIGURED } from './config'
import { Notice, notionError } from './errors'
import { composeTitle, draftTag, isSafeName, STATUS } from './keys'
import type { PageSnapshot } from './parse'
import { fetchedText, parseIssues, parseJson, parsePage, parsePageStatus, parseSchema, PROP } from './parse'

const LIST_LIMIT = 100

export async function callJson($: EngineInterface, tool: string, args: Record<string, unknown>): Promise<unknown> {
  if (!isConfigured()) throw new Notice(NOT_CONFIGURED)
  const result = await $.mcp.call(CONFIG.server, tool, args)
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

export async function fetchSchema($: EngineInterface): Promise<Schema> {
  return parseSchema(await callJson($, 'notion-fetch', { id: dataSourceUrl() }))
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
