import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { McpToolResult, On } from 'claude-code'

import { barSegments, dayDiff, ganttLayout, ganttRows, headerLine, shiftDates } from '../hooks/gantt'
import type { Issue } from '../types'
import type { FakeNotion, Recorded } from './fixtures'
import { fakeNotion, row, RUN } from './fixtures'
import { OPTS } from './fixtures'

const NOW = Date.parse('2026-10-15T03:00:00Z')
const SEK = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1'
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

const SCHEMA = {
  schema: {
    'タスク/プロジェクト名': { type: 'title' },
    'ステータス': { type: 'status', groups: { to_do: [{ name: '未着手' }], in_progress: [{ name: '進行中' }] } },
    '優先順位': { type: 'select', options: [{ name: '中' }] },
    'カテゴリー': { type: 'select', options: [{ name: '仕事' }] },
    '案件タグ': { type: 'multi_select', options: [{ name: 'DemoCLI', color: 'purple' }] },
    '人間ラベル': { type: 'status', groups: { to_do: [{ name: 'AI' }], in_progress: [{ name: '人間' }] } },
    '開始日': { type: 'date' },
    '終了日': { type: 'date' },
  },
}

function reply(value: unknown): { value: McpToolResult } {
  return { value: { content: [{ type: 'text', text: JSON.stringify(value) }], isError: false } }
}

// A Notion whose page carries 開始日 and 終了日, which fixtures.ts does not.
function datedNotion(on: On, calls: Recorded[], pageEnd: string): void {
  const dated = { ...row(SEK, '【DemoCLI】SEK-08 CLI 挙動', '進行中', '2026-10-14'), 'date:開始日:start': '2026-10-12' }
  on('mcp.call', (_$, e) => {
    calls.push({ tool: e.tool, args: e.args })
    if (e.tool === 'notion-query-data-sources') return reply({ results: [dated] })
    if (String(e.args['id']).startsWith('collection://')) {
      return reply({ text: `<data-source-state>\n${JSON.stringify(SCHEMA)}\n</data-source-state>` })
    }
    const props = { 'ステータス': '進行中', 'date:開始日:start': '2026-10-12', 'date:終了日:start': pageEnd }
    return reply({ text: `<properties>\n${JSON.stringify(props)}\n</properties>` })
  })
}

async function openGantt<S extends 'terminal' | 'desktop' | 'vscode'>($: Engine, surface: S) {
  await $.command.run({ ...RUN, args: 'refresh' })
  const ui = await $.ui.mount({ ...PANE, surface })
  await ui.press({ key: 'tab-gantt' })
  return ui
}

function issue(over: Partial<Issue>): Issue {
  const base: Issue = { pageId: 'p', url: 'u', title: 't', key: null, status: '未着手', priority: null, category: null, tags: [], start: null, end: null, owner: null }
  return { ...base, ...over }
}

describe('gantt layout', () => {
  test('fits the range to the width, narrow panes included', () => {
    expect(ganttLayout(64, '2026-10-15')).toEqual({ from: '2026-10-12', days: 25, cellsPerDay: 2, labelWidth: 12, todayOffset: 3 })
    const narrow = ganttLayout(40, '2026-10-15')
    expect(narrow.labelWidth).toBe(8)
    expect(narrow.labelWidth + 1 + narrow.days * narrow.cellsPerDay <= 40).toBe(true)
    expect(headerLine(narrow).length).toBe(narrow.days * narrow.cellsPerDay)
  })

  test('turns dates into day offsets, earliest due first', () => {
    const rows = ganttRows(
      [issue({ pageId: 'b', end: '2026-10-20' }), issue({ pageId: 'a', key: 'SEK-08', start: '2026-10-13', end: '2026-10-14', status: '進行中' }), issue({ pageId: 'n' })],
      '2026-10-15',
      '2026-10-12',
    )
    expect(rows.map(r => r.id)).toEqual(['a', 'b'])
    expect(rows[0]).toEqual({ id: 'a', label: 'SEK-08', start: 1, end: 2, color: 'error' })
    expect(dayDiff('2026-10-12', '2026-10-20')).toBe(8)
  })

  test('draws the bar and the today mark', () => {
    const layout = { from: '2026-10-12', days: 6, cellsPerDay: 1, labelWidth: 8, todayOffset: 3 }
    expect(barSegments(1, 3, layout)).toEqual(['·', '██▓', '··'])
  })

  test('shifts dates without letting the end pass the start', () => {
    expect(shiftDates('2026-10-12', '2026-10-14', 1, 1)).toEqual({ toStart: '2026-10-13', toEnd: '2026-10-15' })
    expect(shiftDates(null, '2026-10-14', 0, -3)).toEqual({ toStart: '2026-10-14', toEnd: '2026-10-14' })
  })
})

test('the gantt view draws its rows on every surface', OPTS, async ($, on) => {
  mock.clock(on, { now: NOW })
  const fake: FakeNotion = { rows: [row(SEK, '【DemoCLI】SEK-08 CLI 挙動', '進行中', '2026-10-14')], pageStatus: '進行中', calls: [] }
  fakeNotion(on, fake, 'main')
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await openGantt($, surface)
    expect(await ui.find({ type: 'Text', text: /SEK-08/, in: 'gantt' })).toBeDefined()
    expect(await ui.find({ key: 'date-end-plus' })).toBeDefined()
    await ui.press({ key: 'gantt-back' })
    await ui.unmount()
  }
  const plain = await openGantt($, 'vscode')
  expect(await plain.find({ type: 'Text', text: /SEK-08/ })).toBeDefined()
  await plain.unmount()
})

test('期限 +1日 writes the new end date only after confirm', OPTS, async ($, on) => {
  mock.clock(on, { now: NOW })
  const calls: Recorded[] = []
  datedNotion(on, calls, '2026-10-14')
  const ui = await openGantt($, 'terminal')
  await ui.press({ key: 'date-end-plus' })
  await ui.press({ key: 'date-end-plus' })
  expect(calls.some(call => call.tool === 'notion-update-page')).toBe(false)
  await ui.press({ key: 'confirm-yes' })
  const written = JSON.stringify(calls.find(call => call.tool === 'notion-update-page')?.args)
  expect(written).toContain('"date:終了日:start":"2026-10-16"')
  expect(written).toContain('"date:開始日:start":"2026-10-12"')
  await ui.unmount()
})

test('dates changed in Notion meanwhile are not overwritten', OPTS, async ($, on) => {
  mock.clock(on, { now: NOW })
  const calls: Recorded[] = []
  datedNotion(on, calls, '2026-10-30')
  const ui = await openGantt($, 'terminal')
  await ui.press({ key: 'date-move-plus' })
  await ui.press({ key: 'confirm-yes' })
  expect(calls.some(call => call.tool === 'notion-update-page')).toBe(false)
  await ui.unmount()
})

test('the Client proposes a change from the keyboard and from a drag post', OPTS, async ($, on) => {
  mock.clock(on, { now: NOW })
  const calls: Recorded[] = []
  datedNotion(on, calls, '2026-10-14')
  const ui = await openGantt($, 'terminal')
  await ui.key({ key: 'right', in: 'gantt' })
  await ui.key({ key: 'return', in: 'gantt' })
  expect(await ui.find({ key: 'confirm-yes' })).toBeDefined()
  await ui.press({ key: 'confirm-no' })
  await ui.post({ type: 'propose', id: SEK, startDelta: -1, endDelta: -1 }, { in: 'gantt' })
  await ui.press({ key: 'confirm-yes' })
  expect(JSON.stringify(calls.find(call => call.tool === 'notion-update-page')?.args)).toContain('"date:開始日:start":"2026-10-11"')
  await ui.unmount()
})
