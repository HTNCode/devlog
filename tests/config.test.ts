import { expect, mock, test } from 'claude-code/testing'

import type { FakeNotion } from './fixtures'
import { BAND, fakeNotion, RUN } from './fixtures'

const UNSET = { options: { dataSource: '' } }

test('without a DB the mod asks for the setting and never calls Notion', UNSET, async ($, on) => {
  mock.clock(on, { now: Date.parse('2026-10-15T03:00:00Z') })
  const fake: FakeNotion = { rows: [], pageStatus: '未着手', calls: [] }
  fakeNotion(on, fake, 'feat/sek-08-help')
  const { text } = await $.command.run({ ...RUN, args: 'list' })
  expect(text ?? '').toContain('DB が未設定')
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /未設定/ })) !== undefined).toBe(true)
  await ui.unmount()
  expect(fake.calls.length).toBe(0)
})
