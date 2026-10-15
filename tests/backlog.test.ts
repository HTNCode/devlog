import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import type { FakeNotion } from './fixtures'
import { BAND, fakeNotion, row, RUN } from './fixtures'
import { OPTS } from './fixtures'

const NOW = Date.parse('2026-10-15T03:00:00Z')
const SEK = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1'
const UX = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb2'

function updates(fake: FakeNotion) {
  return fake.calls.filter(call => call.tool === 'notion-update-page')
}

async function start($: Engine): Promise<void> {
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.command.run({ ...RUN, args: 'refresh' })
}

test('/devlog list answers as quoted data, read in rows mode', OPTS, async ($, on) => {
  mock.clock(on, { now: NOW })
  const fake: FakeNotion = { rows: [row(SEK, '【DemoCLI】SEK-08 CLI 挙動', '進行中', '2026-10-14')], pageStatus: '進行中', calls: [] }
  fakeNotion(on, fake, 'main')
  const { text } = await $.command.run({ ...RUN, args: 'list' })
  expect(text ?? '').toContain('<notion_issues')
  expect(text ?? '').toContain('SEK-08')
  const queries = fake.calls.filter(call => call.tool === 'notion-query-data-sources')
  expect(queries.length).toBe(1)
  expect(JSON.stringify(queries[0]?.args)).toContain('"mode":"rows"')
})

test('the band writes a status only after the confirm button', OPTS, async ($, on) => {
  mock.clock(on, { now: NOW })
  const fake: FakeNotion = { rows: [row(SEK, '【DemoCLI】SEK-08 CLI 挙動', '進行中', '2026-10-14')], pageStatus: '進行中', calls: [] }
  fakeNotion(on, fake, 'feat/sek-08-help')
  await start($)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /SEK-08/ }))?.text ?? '').toContain('進行中')
  await ui.press({ key: 'band-done' })
  expect(updates(fake).length).toBe(0)
  await ui.press({ key: 'confirm-yes' })
  expect(updates(fake).length).toBe(1)
  expect(JSON.stringify(updates(fake)[0]?.args)).toContain('完了')
  await ui.unmount()
})

test('a status changed in Notion meanwhile is not overwritten', OPTS, async ($, on) => {
  mock.clock(on, { now: NOW })
  const fake: FakeNotion = { rows: [row(SEK, '【DemoCLI】SEK-08 CLI 挙動', '進行中', '2026-10-14')], pageStatus: '保留中', calls: [] }
  fakeNotion(on, fake, 'feat/sek-08-help')
  await start($)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await ui.press({ key: 'band-done' })
  await ui.press({ key: 'confirm-yes' })
  expect(updates(fake).length).toBe(0)
  await ui.unmount()
})

test('a key shared by two issues shows no write button', OPTS, async ($, on) => {
  mock.clock(on, { now: NOW })
  const rows = [row(SEK, '【DemoCLI】SEK-08 CLI 挙動', '進行中', '2026-10-14'), row(UX, '【別案件】SEK-08 別件', '未着手', '2026-10-20')]
  const fake: FakeNotion = { rows, pageStatus: '進行中', calls: [] }
  fakeNotion(on, fake, 'feat/sek-08-help')
  await start($)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect((await ui.find({ type: 'Text', text: /SEK-08/ }))?.text ?? '').toContain('2 件')
    expect(await ui.find({ key: 'band-done' })).toBe(undefined)
    await ui.unmount()
  }
})
