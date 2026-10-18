import { expect, mock, test } from 'claude-code/testing'

import type { FakeNotion } from './fixtures'
import { fakeNotion, row, RUN } from './fixtures'
import { OPTS } from './fixtures'

const NOW = Date.parse('2026-10-15T03:00:00Z')
const SEK = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1'
const UX = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb2'

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
  return {
    rows: [row(SEK, '【DemoCLI】SEK-08 CLI 挙動', '進行中', '2026-10-14'), row(UX, '【DemoCLI】SEK-09 ヘルプ', '未着手', '2026-10-30')],
    pageStatus: '未着手',
    calls: [],
  }
}

test('the pane lists issues, filters by tab and changes a status through confirm', OPTS, async ($, on) => {
  mock.clock(on, { now: NOW })
  const notion = fake()
  fakeNotion(on, notion, 'main')
  await $.command.run({ ...RUN, args: 'refresh' })
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /SEK-09/ })).toBeDefined()
    await ui.press({ key: 'tab-doing' })
    expect(await ui.find({ type: 'Text', text: /SEK-09/ })).toBe(undefined)
    await ui.press({ key: 'tab-open' })
    await ui.unmount()
  }
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: `sel-${UX}` })
  await ui.press({ key: `to-${UX}-進行中` })
  expect(notion.calls.some(call => call.tool === 'notion-update-page')).toBe(false)
  await ui.press({ key: 'confirm-yes' })
  expect(notion.calls.filter(call => call.tool === 'notion-update-page').length).toBe(1)
  await ui.unmount()
})

test('the create form keeps confirm hidden until every required field is set', OPTS, async ($, on) => {
  mock.clock(on, { now: NOW })
  const notion = fake()
  fakeNotion(on, notion, 'main')
  const { text } = await $.command.run({ ...RUN, args: 'new' })
  expect(text ?? '').toContain('課題ペインを開きました')
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ key: 'review' })).toBe(undefined)
  await ui.input({ key: 'f-title', text: 'ヘルプの文言修正' })
  await ui.press({ key: 'review' })
  expect(notion.calls.some(call => call.tool === 'notion-create-pages')).toBe(false)
  await ui.press({ key: 'confirm-yes' })
  const created = notion.calls.find(call => call.tool === 'notion-create-pages')
  expect(JSON.stringify(created?.args)).toContain('【DemoCLI】ヘルプの文言修正')
  expect(JSON.stringify(created?.args)).toContain('2026-10-17')
  await ui.unmount()
})

test('a new 案件タグ keeps every existing option and its color', OPTS, async ($, on) => {
  mock.clock(on, { now: NOW })
  const notion = fake()
  fakeNotion(on, notion, 'main')
  await $.command.run({ ...RUN, args: 'new' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.input({ key: 'f-title', text: '初期設定' })
  await ui.input({ key: 'f-newTag', text: '新案件' })
  await ui.press({ key: 'review' })
  await ui.press({ key: 'confirm-yes' })
  const ddl = notion.calls.find(call => call.tool === 'notion-update-data-source')
  expect(String(ddl?.args['statements'])).toBe(
    `ALTER COLUMN "案件タグ" SET MULTI_SELECT('DemoCLI':purple, 'SampleApp':gray, '新案件':default)`,
  )
  const created = notion.calls.find(call => call.tool === 'notion-create-pages')
  expect(JSON.stringify(created?.args)).toContain('【新案件】初期設定')
  await ui.unmount()
})

test('a bare /devlog or /dl toggles the pane, and q closes it', OPTS, async ($, on) => {
  mock.clock(on, { now: NOW })
  const closes: string[] = []
  fakeNotion(on, { ...fake(), closes }, 'main')
  expect((await $.command.run({ ...RUN, args: '' })).text ?? '').toContain('課題ペインを開きました')
  expect((await $.command.run({ ...RUN, command: 'dl', args: '' })).text ?? '').toContain('課題ペインを閉じました')
  await $.command.run({ ...RUN, command: 'dl', args: '' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'close' })
  expect(closes).toEqual(['plugin', 'plugin'])
  await ui.unmount()
})

test('a pane closed on the gantt reopens at the gantt width', OPTS, async ($, on) => {
  mock.clock(on, { now: NOW })
  const opens: number[] = []
  fakeNotion(on, { ...fake(), opens }, 'main')
  await $.command.run({ ...RUN, args: 'gantt' })
  await $.command.run({ ...RUN, args: '' })
  await $.command.run({ ...RUN, args: '' })
  expect(opens.length).toBe(2)
  expect(opens[1]).toBe(opens[0])
  // The opens left loads running; this joins them before the test ends.
  await $.command.run({ ...RUN, args: 'refresh' })
})

