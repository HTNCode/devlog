import { expect, mock, test } from 'claude-code/testing'

import type { FakeNotion } from './fixtures'
import { fakeNotion, row, RUN } from './fixtures'
import { OPTS } from './fixtures'

const NOW = Date.parse('2026-10-15T03:00:00Z')
const SEK = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1'
const USAGE = { input_tokens: 10, output_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }

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

// The kit cannot raise the person's Esc (ui.close); the close button runs
// the same closeSummary the Esc hook in summary.ts calls.
test('the selected row opens its summary in green, the close button and the toggle close and reopen it', OPTS, async ($, on) => {
  mock.clock(on, { now: NOW })
  const fake: FakeNotion = { rows: [row(SEK, '【DemoCLI】SEK-08 CLI 挙動', '進行中', '2026-10-14')], pageStatus: '進行中', calls: [] }
  fakeNotion(on, fake, 'main')
  let asked = 0
  on('model.complete', () => {
    asked += 1
    return { value: { isAnswered: true as const, text: '・ヘルプ表示を直す\n・終了コードを揃える', usage: USAGE } }
  })
  await $.command.run({ ...RUN, args: 'refresh' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: `sel-${SEK}` })
  expect(await ui.find({ type: 'Text', text: /ヘルプ表示を直す/ })).toBe(undefined)
  await ui.press({ key: `sel-${SEK}` })
  const line = await ui.find({ type: 'Text', text: /ヘルプ表示を直す/ })
  expect(line?.props['color']).toBe('success')
  expect((await ui.find({ type: 'Text', text: /SEK-08/ }))?.props['color']).toBe('success')
  await ui.press({ key: `summary-close-${SEK}` })
  expect(await ui.find({ type: 'Text', text: /ヘルプ表示を直す/ })).toBe(undefined)
  await ui.press({ key: `sum-${SEK}` })
  expect(await ui.find({ type: 'Text', text: /ヘルプ表示を直す/ })).toBeDefined()
  expect(asked).toBe(1)
  await ui.unmount()
})
