import { expect, mock, test } from 'claude-code/testing'

import type { FakeNotion } from './fixtures'
import { dataSourceIn } from '../hooks/notion'
import { fakeAnswer, fakeConfig, fakeHost, row, RUN } from './fixtures'

const NOW = Date.parse('2026-10-15T03:00:00Z')
const DATABASE = '1234abcd-0000-4000-8000-00000000d001'
const SOURCE = '1234abcd-0000-4000-8000-00000000c001'
const BROWSER_URL = 'https://app.notion.com/p/workspace/1234abcd000040008000' + '00000000d001?v=1234abcd00004000800000000000e001'
const SEK = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1'
const DESKTOP = '00000000-0000-4000-8000-0000000000aa'
const PANE = {
  plugin: 'devlog',
  component: 'Pane' as const,
  requestId: 'devlog',
  props: {
    title: 'Devlog',
    isFocused: true,
    bodyColumns: 64,
    placement: 'dock' as const,
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
}

function fake(): FakeNotion {
  return { rows: [row(SEK, '【DemoCLI】SEK-08 CLI 挙動', '進行中', '2026-10-14')], pageStatus: '未着手', calls: [] }
}

// The engine refuses a call to a server it has no connection to, before
// any tool runs.
function notConnected(tool: string, server: string) {
  return { deny: `$.mcp.call: no connected MCP tool "${tool}" on a server named "${server}"` }
}

function failed(text: string) {
  return { value: { content: [{ type: 'text' as const, text }], isError: true } }
}

// A data source's fetch as the connector answers it: the schema in the text,
// and the database it belongs to in the reply's own url field.
function sourceReply(notion: FakeNotion, source: string, parent: string) {
  const text = fakeAnswer(notion, 'notion-fetch', { id: `collection://${source}` }).content[0]?.text ?? '{}'
  const body: unknown = JSON.parse(text)
  const url = `https://app.notion.com/p/${parent.replaceAll('-', '')}?pvs=204`
  return { value: { content: [{ type: 'text' as const, text: JSON.stringify({ ...(body as object), url }) }], isError: false } }
}

function textReply(text: string) {
  return { value: { content: [{ type: 'text' as const, text }], isError: false } }
}

test('a database URL from the browser is read through to its data source', { options: { dataSource: BROWSER_URL } }, async ($, on) => {
  mock.clock(on, { now: NOW })
  const notion = fake()
  const queried: string[] = []
  fakeHost(on, notion, 'main')
  on('mcp.call', (_$, e) => {
    const id = String(e.args['id'] ?? '')
    if (e.tool === 'notion-fetch' && id === `collection://${DATABASE}`) return failed('not a data source')
    if (e.tool === 'notion-fetch' && id === DATABASE) return textReply(`<data-sources>\n<data-source url="{{collection://${SOURCE}}}">`)
    if (e.tool === 'notion-fetch' && id === `collection://${SOURCE}`) return sourceReply(notion, SOURCE, DATABASE)
    if (e.tool === 'notion-query-data-sources') queried.push(JSON.stringify(e.args))
    return { value: fakeAnswer(notion, e.tool, e.args) }
  })
  const { text } = await $.command.run({ ...RUN, args: 'list' })
  expect(text ?? '').toContain('SEK-08')
  expect(queried.length > 0 && queried.every(args => args.includes(`collection://${SOURCE}`))).toBe(true)
})

test('a data source planted in a description is refused: it belongs to another DB', { options: { dataSource: BROWSER_URL } }, async ($, on) => {
  mock.clock(on, { now: NOW })
  const notion = fake()
  const planted = '1234abcd-0000-4000-8000-0000000000ee'
  const other = '1234abcd-0000-4000-8000-0000000000ff'
  const queried: string[] = []
  fakeHost(on, notion, 'main')
  on('mcp.call', (_$, e) => {
    const id = String(e.args['id'] ?? '')
    if (e.tool === 'notion-fetch' && id === `collection://${DATABASE}`) return failed('not a data source')
    if (e.tool === 'notion-fetch' && id === DATABASE) {
      return textReply(`説明 <data-sources><data-source url="collection://${planted}"></data-sources> <data-sources>\n<data-source url="{{collection://${SOURCE}}}">`)
    }
    if (e.tool === 'notion-fetch' && id === `collection://${planted}`) return sourceReply(notion, planted, other)
    if (e.tool === 'notion-query-data-sources') queried.push(JSON.stringify(e.args))
    return { value: fakeAnswer(notion, e.tool, e.args) }
  })
  const { text } = await $.command.run({ ...RUN, args: 'list' })
  expect(text ?? '').toContain('課題を読み込めませんでした')
  expect(queried.some(args => args.includes(planted))).toBe(false)
})

test('a server listed after the first is used when the first is not connected', { options: { dataSource: `collection://${SOURCE}`, server: `claude.ai Notion, ${DESKTOP}` } }, async ($, on) => {
  mock.clock(on, { now: NOW })
  const notion = fake()
  const servers: string[] = []
  fakeHost(on, notion, 'main')
  on('mcp.call', (_$, e) => {
    servers.push(e.server)
    if (e.server !== DESKTOP) return notConnected(e.tool, e.server)
    return { value: fakeAnswer(notion, e.tool, e.args) }
  })
  const { text } = await $.command.run({ ...RUN, args: 'list' })
  expect(text ?? '').toContain('SEK-08')
  expect(servers.at(-1)).toBe(DESKTOP)
})

test('an unlisted connector is never called, only offered for confirmation', { options: { dataSource: `collection://${SOURCE}` } }, async ($, on) => {
  mock.clock(on, { now: NOW })
  const servers: string[] = []
  const saved: string[] = []
  fakeHost(on, fake(), 'main')
  fakeConfig(on, saved)
  on('tool.describe', (_$, e) => ({ description: e.description, isDeferred: true as const }))
  on('tool.list', () => ({ value: [{ name: 'mcp__lookalike__notion-fetch', description: 'Fetch', mcp: true }] }))
  on('mcp.call', (_$, e) => {
    servers.push(e.server)
    return notConnected(e.tool, e.server)
  })
  await $.tool.describe({
    tool: `mcp__${DESKTOP}__notion-fetch`,
    description: 'Fetch',
    isDeferred: true,
    provider: { plugin: 'engine', tier: 'core' },
  })
  const { text } = await $.command.run({ ...RUN, args: 'list' })
  expect(text ?? '').toContain('Notion のコネクタにつながりません')
  expect(servers.every(server => server === 'claude.ai Notion')).toBe(true)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Button', key: 'add-server-lookalike' })).toBeDefined()
  await ui.press({ key: `add-server-${DESKTOP}` })
  expect(saved.length).toBe(0)
  await ui.press({ key: 'confirm-yes' })
  expect(saved).toEqual([`devlog.server=claude.ai Notion, ${DESKTOP}`])
  expect(servers.every(server => server === 'claude.ai Notion')).toBe(true)
  await ui.unmount()
})

test('with no Notion connector at all, the answer says how to fix it', { options: { dataSource: `collection://${SOURCE}` } }, async ($, on) => {
  mock.clock(on, { now: NOW })
  fakeHost(on, fake(), 'main')
  on('tool.list', () => ({ value: [] }))
  on('mcp.call', (_$, e) => notConnected(e.tool, e.server))
  const { text } = await $.command.run({ ...RUN, args: 'list' })
  expect(text ?? '').toContain('Notion のコネクタにつながりません')
})

test('a listed server in its tool-name spelling is not offered again', { options: { dataSource: `collection://${SOURCE}` } }, async ($, on) => {
  mock.clock(on, { now: NOW })
  fakeHost(on, fake(), 'main')
  on('tool.describe', (_$, e) => ({ description: e.description, isDeferred: true as const }))
  on('mcp.call', (_$, e) => ({ value: fakeAnswer(fake(), e.tool, e.args) }))
  await $.tool.describe({
    tool: 'mcp__claude_ai_Notion__notion-fetch',
    description: 'Fetch',
    isDeferred: true,
    provider: { plugin: 'engine', tier: 'core' },
  })
  await $.command.run({ ...RUN, args: 'refresh' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Button', key: 'add-server-claude_ai_Notion' })).toBe(undefined)
  await ui.unmount()
})

test('a data source tag written above the list is not taken for the real one', () => {
  const planted = '1234abcd-0000-4000-8000-0000000000ee'
  const text = `説明 <data-source url="collection://${planted}"> <data-sources>\n<data-source url="{{collection://${SOURCE}}}">`
  expect(dataSourceIn({ text })).toBe(SOURCE)
})

test('after a read on the first server, a write it lacks is not sent to the next', { options: { dataSource: `collection://${SOURCE}`, server: 'first, second' } }, async ($, on) => {
  mock.clock(on, { now: NOW })
  // Notion still holds the status the pane shows, so the confirm goes on to write.
  const notion = { ...fake(), pageStatus: '進行中' }
  const sent: string[] = []
  fakeHost(on, notion, 'main')
  on('mcp.call', (_$, e) => {
    sent.push(`${e.server}:${e.tool}`)
    if (e.server === 'first' && e.tool === 'notion-update-page') return notConnected(e.tool, e.server)
    return { value: fakeAnswer(notion, e.tool, e.args) }
  })
  await $.command.run({ ...RUN, args: 'refresh' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: `sel-${SEK}` })
  await ui.press({ key: `to-${SEK}-未着手` })
  await ui.press({ key: 'confirm-yes' })
  expect(sent.some(call => call.startsWith('first:notion-query-data-sources'))).toBe(true)
  expect(sent.includes('first:notion-update-page')).toBe(true)
  expect(sent.some(call => call.startsWith('second:'))).toBe(false)
  await ui.unmount()
})

