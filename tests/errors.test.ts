import { describe, expect, test } from 'claude-code/testing'

import { errorText, isRefusedBeforeRun, Notice, notionError } from '../hooks/errors'

describe('errorText', () => {
  test("shows the mod's own text and nothing of anyone else's", () => {
    expect(errorText(new Notice('DB が未設定です'))).toBe('DB が未設定です')
    const shown = errorText(new Error('{"password":"correct horse battery staple"}'))
    expect(shown.includes('horse')).toBe(false)
    expect(shown).toBe('予期しないエラーが発生しました')
  })

  test('names a refusal by the auto mode classifier and a timeout', () => {
    expect(errorText(new Error('$.mcp.call(x, notion-fetch) refused: The server-side auto mode classifier gave no verdict'))).toContain('auto モード')
    expect(errorText(new Error('request timed out after 30s'))).toContain('タイムアウト')
  })

  test("never shows Notion's error body, only a fixed reason", () => {
    const shown = notionError('notion-fetch', 'Could not find page. Authorization: Bearer secret value 123').message
    expect(shown).toContain('対象が見つからない')
    expect(shown.includes('secret')).toBe(false)
    expect(notionError('notion-fetch', 'odd').message).toContain('理由は不明')
  })

  test("no Notion error counts as never run: its text cannot tell", () => {
    expect(isRefusedBeforeRun(notionError('notion-create-database', 'validation error: 400'))).toBe(false)
    expect(isRefusedBeforeRun(notionError('notion-create-database', 'internal server error 500'))).toBe(false)
    expect(isRefusedBeforeRun(new Error('request timed out'))).toBe(false)
    expect(isRefusedBeforeRun(new Notice('DB は設定済みです'))).toBe(true)
    expect(isRefusedBeforeRun(new Error('$.mcp.call(x, notion-create-database) refused: The server-side auto mode classifier gave no verdict'))).toBe(true)
  })

  test('an id in the text names no reason', () => {
    const shown = notionError('notion-create-database', 'Unexpected response for database 1234abcd-0000-4000-8000-00000000b001').message
    expect(shown).toContain('理由は不明')
  })
})
