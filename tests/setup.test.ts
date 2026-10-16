import type { McpToolResult, On } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'

import { createdDatabaseId, parentPageId, setupSchema } from '../hooks/setup'
import type { FakeNotion } from './fixtures'
import { CREATED_DB, fakeAnswer, fakeConfig, fakeHost, fakeNotion, OPTS, RUN } from './fixtures'

const NOW = Date.parse('2026-10-15T03:00:00Z')
const UNSET = { options: { dataSource: '' } }
const PARENT = '1234abcd00004000800000000000a001'

const PANE = {
  plugin: 'notion-backlog',
  component: 'Pane' as const,
  requestId: 'notion-backlog',
  props: {
    title: 'Devlog',
    isFocused: true,
    bodyColumns: 64,
    placement: 'dock' as const,
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
}

function emptyNotion(): FakeNotion {
  return { rows: [], pageStatus: '未着手', calls: [] }
}

describe('setup', () => {
  test('takes the new DB id only from a Notion URL', () => {
    expect(createdDatabaseId({ text: `<database url="{{${NEW_DB_URL}}}">` })).toBe(NEW_DB_ID)
    expect(createdDatabaseId({ text: '<database url="{{https://example.invalid/p/1234abcd00004000800000000000b001}}">' })).toBe(null)
    expect(createdDatabaseId({ text: '<database url="{{https://notion.so.example.invalid/1234abcd00004000800000000000b001}}">' })).toBe(null)
    expect(createdDatabaseId({ text: 'no tag' })).toBe(null)
  })

  test('takes the page id from the path, not the view id in the query', () => {
    const url = `https://app.notion.com/p/workspace/Tickets-${PARENT}?v=1234abcd00004000800000000000e001`
    expect(parentPageId(url)).toBe('1234abcd-0000-4000-8000-00000000a001')
    expect(parentPageId('')).toBe(null)
  })

  test('builds every property parseSchema expects, with a seed 案件タグ', () => {
    const schema = setupSchema() ?? ''
    expect(schema).toContain('"タスク/プロジェクト名" TITLE')
    expect(schema).toContain("STATUS('未着手':gray:to_do, '進行中':blue:in_progress, '完了':green:complete)")
    expect(schema).toContain(`"人間ラベル" STATUS('AI':default:to_do, '人間':blue:in_progress)`)
    expect(schema).toContain(`"案件タグ" MULTI_SELECT('未分類':gray)`)
    expect(schema).toContain('"開始日" DATE')
    expect(schema).toContain('"終了日" DATE')
  })
})

test('/devlog setup creates the DB only after confirm and saves it as dataSource', UNSET, async ($, on) => {
  mock.clock(on, { now: NOW })
  const notion = emptyNotion()
  const saved: string[] = []
  fakeConfig(on, saved)
  fakeNotion(on, notion, 'main')
  const { text } = await $.command.run({ ...RUN, args: `setup https://app.notion.com/p/${PARENT}` })
  expect(text ?? '').toContain('ペインの確定ボタンで作成します')
  expect(notion.calls.length).toBe(0)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /課題 DB「Devlog 課題」を作成（ページ 1234abcd-0000-4000-8000-00000000a001 の下）/ })).toBeDefined()
  await ui.press({ key: 'confirm-yes' })
  const created = notion.calls.filter(call => call.tool === 'notion-create-database')
  expect(created.length).toBe(1)
  expect(created[0]?.args['parent']).toEqual({ type: 'page_id', page_id: '1234abcd-0000-4000-8000-00000000a001' })
  expect(String(created[0]?.args['schema'])).toContain('MULTI_SELECT')
  expect(saved).toEqual([`notion-backlog.dataSource=${CREATED_DB}`])
  await ui.unmount()
})

test('cancelling setup writes nothing', UNSET, async ($, on) => {
  mock.clock(on, { now: NOW })
  const notion = emptyNotion()
  const saved: string[] = []
  fakeConfig(on, saved)
  fakeNotion(on, notion, 'main')
  await $.command.run({ ...RUN, args: 'setup' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /ワークスペース直下・非公開/ })).toBeDefined()
  await ui.press({ key: 'confirm-no' })
  expect(await ui.find({ type: 'Button', key: 'confirm-yes' })).toBe(undefined)
  expect(notion.calls.length).toBe(0)
  expect(saved.length).toBe(0)
  await ui.unmount()
})

test('setup refuses once a DB is set, without calling Notion', OPTS, async ($, on) => {
  mock.clock(on, { now: NOW })
  const notion = emptyNotion()
  fakeNotion(on, notion, 'main')
  const before = notion.calls.length
  const { text } = await $.command.run({ ...RUN, args: 'setup' })
  expect(text ?? '').toContain('DB は設定済みです')
  expect(notion.calls.slice(before).some(call => call.tool === 'notion-create-database')).toBe(false)
})

test('a page URL with no id is refused, not taken as no page', UNSET, async ($, on) => {
  mock.clock(on, { now: NOW })
  const notion = emptyNotion()
  fakeNotion(on, notion, 'main')
  const { text } = await $.command.run({ ...RUN, args: 'setup https://www.notion.so/' })
  expect(text ?? '').toContain('ID を読み取れませんでした')
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Button', key: 'confirm-yes' })).toBe(undefined)
  expect(notion.calls.length).toBe(0)
  await ui.unmount()
})

test('when dataSource cannot be saved, the new DB id is still shown', UNSET, async ($, on) => {
  mock.clock(on, { now: NOW })
  const toasts: string[] = []
  fakeNotion(on, emptyNotion(), 'main')
  on('config.list', () => ({ value: [] }))
  on('ui.toast', (_$, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  await $.command.run({ ...RUN, args: 'setup' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'confirm-yes' })
  expect(toasts.some(text => text.includes(CREATED_DB))).toBe(true)
  await ui.unmount()
})

const NEW_DB_URL = 'https://app.notion.com/p/1234abcd00004000800000000000b001'
const NEW_DB_ID = '1234abcd-0000-4000-8000-00000000b001'

// A create reply that names the database but not its data source.
function createdWithoutSource(on: On, sourceOnFetch: boolean, toasts: string[]): void {
  const notion = emptyNotion()
  fakeHost(on, notion, 'main')
  on('ui.toast', (_$, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('mcp.call', (_$, e) => {
    const reply = (text: string) => ({ value: { content: [{ type: 'text' as const, text }], isError: false } })
    if (e.tool === 'notion-create-database') return reply(`<database url="{{${NEW_DB_URL}}}">`)
    if (e.tool === 'notion-fetch' && e.args['id'] === NEW_DB_ID) {
      return reply(sourceOnFetch ? `<data-source url="{{${CREATED_DB}}}">` : 'no tag')
    }
    return { value: fakeAnswer(notion, e.tool, e.args) }
  })
}

test('a create reply without the data source is read back through the new DB URL', UNSET, async ($, on) => {
  mock.clock(on, { now: NOW })
  const saved: string[] = []
  const toasts: string[] = []
  createdWithoutSource(on, true, toasts)
  fakeConfig(on, saved)
  await $.command.run({ ...RUN, args: 'setup' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'confirm-yes' })
  expect(saved).toEqual([`notion-backlog.dataSource=${CREATED_DB}`])
  await ui.unmount()
})

test('a DB made but not identified is reported as made, never as a failure', UNSET, async ($, on) => {
  mock.clock(on, { now: NOW })
  const saved: string[] = []
  const toasts: string[] = []
  createdWithoutSource(on, false, toasts)
  fakeConfig(on, saved)
  await $.command.run({ ...RUN, args: 'setup' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'confirm-yes' })
  expect(toasts.some(text => text.includes('作成されましたが') && text.includes(NEW_DB_ID))).toBe(true)
  expect(toasts.some(text => text.includes('作れませんでした'))).toBe(false)
  expect(saved.length).toBe(0)
  await ui.unmount()
})

test('setup leaves a create form left in state for the list, so its confirm row shows', UNSET, async ($, on) => {
  mock.clock(on, { now: NOW })
  fakeNotion(on, emptyNotion(), 'main')
  // A create form left from before the DB setting was cleared: the view,
  // the schema and the draft still stand in state until the plugin writes them.
  const stale: Record<string, unknown> = {
    view: 'create',
    schema: {
      isWritable: true,
      problem: null,
      tags: [{ name: 'DemoCLI', color: 'purple' }],
      statuses: ['未着手', '進行中', '完了'],
      categories: ['仕事'],
      priorities: ['中'],
      owners: ['AI', '人間'],
    },
    draft: { title: '下書き', key: '', tag: 'DemoCLI', newTag: '', category: '仕事', priority: '中', owner: '人間', start: '2026-10-15', end: '2026-10-17' },
  }
  on('state.get', (_$, e, next) => (e.key in stale ? { value: { value: stale[e.key], version: 1 } } : next(e)))
  on('state.set', (_$, e, next) => {
    delete stale[e.key]
    return next(e)
  })
  await $.command.run({ ...RUN, args: 'setup' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Button', key: 'confirm-yes' })).toBeDefined()
  await ui.unmount()
})

test('two presses of confirm create one DB', UNSET, async ($, on) => {
  mock.clock(on, { now: NOW })
  const notion = emptyNotion()
  const saved: string[] = []
  fakeConfig(on, saved)
  fakeNotion(on, notion, 'main')
  await $.command.run({ ...RUN, args: 'setup' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await Promise.all([ui.press({ key: 'confirm-yes' }), ui.press({ key: 'confirm-yes' })])
  expect(notion.calls.filter(call => call.tool === 'notion-create-database').length).toBe(1)
  await ui.unmount()
})

type McpAnswer = { value: McpToolResult } | { deny: string }

// A create that fails in the given way, with every toast kept.
function failingCreate(on: On, answer: () => McpAnswer, toasts: string[]): void {
  const notion = emptyNotion()
  fakeHost(on, notion, 'main')
  on('ui.toast', (_$, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('mcp.call', (_$, e) => (e.tool === 'notion-create-database' ? answer() : { value: fakeAnswer(notion, e.tool, e.args) }))
}

test('a Notion error on create is reported as unknown, never as not made', UNSET, async ($, on) => {
  mock.clock(on, { now: NOW })
  const toasts: string[] = []
  const body = 'validation error 400 for database 1234abcd-0000-4000-8000-00000000b001'
  failingCreate(on, () => ({ value: { content: [{ type: 'text' as const, text: body }], isError: true } }), toasts)
  await $.command.run({ ...RUN, args: 'setup' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'confirm-yes' })
  expect(toasts.some(text => text.startsWith('作成結果を確認できませんでした'))).toBe(true)
  expect(toasts.some(text => text.startsWith('DB を作れませんでした'))).toBe(false)
  await ui.unmount()
})

test('a create that timed out is reported as unknown, never as not made', UNSET, async ($, on) => {
  mock.clock(on, { now: NOW })
  const toasts: string[] = []
  failingCreate(on, () => ({ deny: 'request timed out after 30s' }), toasts)
  await $.command.run({ ...RUN, args: 'setup' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'confirm-yes' })
  expect(toasts.some(text => text.startsWith('作成結果を確認できませんでした'))).toBe(true)
  expect(toasts.some(text => text.startsWith('DB を作れませんでした'))).toBe(false)
  await ui.unmount()
})

test('a create Notion failed midway is reported as unknown, never as not made', UNSET, async ($, on) => {
  mock.clock(on, { now: NOW })
  const toasts: string[] = []
  failingCreate(on, () => ({ value: { content: [{ type: 'text' as const, text: 'internal error' }], isError: true } }), toasts)
  await $.command.run({ ...RUN, args: 'setup' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'confirm-yes' })
  expect(toasts.some(text => text.startsWith('作成結果を確認できませんでした'))).toBe(true)
  expect(toasts.some(text => text.startsWith('DB を作れませんでした'))).toBe(false)
  await ui.unmount()
})

test('a create the first listed server lacks is never sent to the next one', { options: { dataSource: '', server: 'first, second' } }, async ($, on) => {
  mock.clock(on, { now: NOW })
  const notion = emptyNotion()
  const sent: string[] = []
  const toasts: string[] = []
  fakeHost(on, notion, 'main')
  on('ui.toast', (_$, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('mcp.call', (_$, e) => {
    sent.push(`${e.server}:${e.tool}`)
    if (e.server === 'first' && e.tool === 'notion-create-database') {
      return { deny: `$.mcp.call: no connected MCP tool "${e.tool}" on a server named "${e.server}"` }
    }
    return { value: fakeAnswer(notion, e.tool, e.args) }
  })
  await $.command.run({ ...RUN, args: 'setup' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'confirm-yes' })
  expect(sent.some(call => call.startsWith('second:'))).toBe(false)
  expect(toasts.some(text => text.includes('接続先「first」で notion-create-database を使えません'))).toBe(true)
  await ui.unmount()
})

test('a first setup with the connector under another name offers it in the pane', UNSET, async ($, on) => {
  mock.clock(on, { now: NOW })
  const notion = emptyNotion()
  const calls: string[] = []
  fakeHost(on, notion, 'main')
  on('tool.list', () => ({ value: [{ name: 'mcp__alias__notion-fetch', description: 'Fetch', mcp: true }] }))
  on('mcp.call', (_$, e) => {
    calls.push(e.server)
    return { deny: `$.mcp.call: no connected MCP tool "${e.tool}" on a server named "${e.server}"` }
  })
  await $.command.run({ ...RUN, args: 'setup' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'confirm-yes' })
  expect(await ui.find({ type: 'Button', key: 'add-server-alias' })).toBeDefined()
  expect(calls.every(server => server === 'claude.ai Notion')).toBe(true)
  await ui.unmount()
})
