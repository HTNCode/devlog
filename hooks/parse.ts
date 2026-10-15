import type { Issue, Schema, TagOption } from '../types'
import { CONFIG } from './config'
import { keyFromTitle } from './keys'

// Notion's replies arrive as JSON text with no schema library available in
// the mod environment, so they are read as `unknown` and narrowed by hand.
type JsonObject = Record<string, unknown>

// The person's property names (config.ts), updated in place on reload.
export const PROP = CONFIG.prop

function isRecord(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null
}

function strList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
}

export function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

function parseTags(value: unknown): string[] {
  if (Array.isArray(value)) return strList(value)
  const text = str(value)
  return text === null ? [] : strList(parseJson(text))
}

export function pageIdFromUrl(url: string): string | null {
  return /([0-9a-f]{32})(?:[?#].*)?$/.exec(url)?.[1] ?? null
}

export function parseIssue(row: unknown): Issue | null {
  if (!isRecord(row)) return null
  const url = str(row['url'])
  const pageId = url === null ? null : pageIdFromUrl(url)
  if (url === null || pageId === null) return null
  const title = str(row[PROP.title]) ?? '(無題)'
  return {
    pageId,
    url,
    title,
    key: keyFromTitle(title),
    status: str(row[PROP.status]) ?? CONFIG.status.todo,
    priority: str(row[PROP.priority]),
    category: str(row[PROP.category]),
    tags: parseTags(row[PROP.tags]),
    start: str(row[`date:${PROP.start}:start`]),
    end: str(row[`date:${PROP.end}:start`]),
    owner: str(row[PROP.owner]),
  }
}

export function parseIssues(reply: unknown): Issue[] {
  if (!isRecord(reply) || !Array.isArray(reply['results'])) {
    throw new Error('課題一覧の応答を読めませんでした')
  }
  return reply['results'].map(parseIssue).filter((issue): issue is Issue => issue !== null)
}

function between(text: string, tag: string): unknown {
  const found = new RegExp(`<${tag}>\\s*([\\s\\S]*?)\\s*</${tag}>`).exec(text)?.[1]
  return found === undefined ? undefined : parseJson(found)
}

// A fetch reply is `{ text }` whose text wraps the JSON of interest in tags.
export function fetchedText(reply: unknown): string {
  if (isRecord(reply) && typeof reply['text'] === 'string') return reply['text']
  throw new Error('Notion の fetch 応答を読めませんでした')
}

export function parsePageStatus(reply: unknown): string | null {
  return parsePage(reply).status
}

export type PageSnapshot = { status: string | null; start: string | null; end: string | null; content: string }

// One page as notion-fetch returns it: the properties JSON and the body,
// which is untrusted text written by anyone with access to the page.
export function parsePage(reply: unknown): PageSnapshot {
  const text = fetchedText(reply)
  const props = between(text, 'properties')
  const content = /<content>\s*([\s\S]*?)\s*<\/content>/.exec(text)?.[1] ?? ''
  if (!isRecord(props)) return { status: null, start: null, end: null, content }
  return {
    status: str(props[PROP.status]),
    start: str(props[`date:${PROP.start}:start`]),
    end: str(props[`date:${PROP.end}:start`]),
    content,
  }
}

function optionNames(prop: unknown): TagOption[] {
  if (!isRecord(prop) || !Array.isArray(prop['options'])) return []
  return prop['options'].filter(isRecord).flatMap(option => {
    const name = str(option['name'])
    return name === null ? [] : [{ name, color: str(option['color']) ?? 'default' }]
  })
}

function statusNames(prop: unknown): string[] {
  if (!isRecord(prop) || !isRecord(prop['groups'])) return []
  return Object.values(prop['groups']).flatMap(group =>
    Array.isArray(group) ? group.filter(isRecord).flatMap(o => str(o['name']) ?? []) : [],
  )
}

function expected(): ReadonlyArray<readonly [string, string]> {
  return [
  [PROP.title, 'title'],
  [PROP.status, 'status'],
  [PROP.priority, 'select'],
  [PROP.category, 'select'],
  [PROP.tags, 'multi_select'],
  [PROP.owner, 'status'],
  [PROP.start, 'date'],
  [PROP.end, 'date'],
  ]
}

export function readOnlySchema(problem: string): Schema {
  return { isWritable: false, problem, tags: [], statuses: [], categories: [], priorities: [], owners: [] }
}

// A renamed or retyped property turns the mod read-only instead of writing
// into the wrong column.
export function parseSchema(reply: unknown): Schema {
  const state = between(fetchedText(reply), 'data-source-state')
  const schema = isRecord(state) ? state['schema'] : undefined
  if (!isRecord(schema)) return readOnlySchema('DB のプロパティ構成を読めませんでした')
  const broken = expected().filter(([name, type]) => {
    const prop = schema[name]
    return !isRecord(prop) || prop['type'] !== type
  }).map(([name]) => name)
  if (broken.length > 0) return readOnlySchema(`プロパティが想定と異なります: ${broken.join(', ')}`)
  return {
    isWritable: true,
    problem: null,
    tags: optionNames(schema[PROP.tags]),
    statuses: statusNames(schema[PROP.status]),
    categories: optionNames(schema[PROP.category]).map(o => o.name),
    priorities: optionNames(schema[PROP.priority]).map(o => o.name),
    owners: statusNames(schema[PROP.owner]),
  }
}
