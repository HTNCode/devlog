import { describe, expect, test } from 'claude-code/testing'

import type { Draft, Issue, Schema } from '../types'
import { composeTitle, filterTab, keyFromBranch, keyFromTitle, matchIssues, missingFields, todayJst } from '../hooks/keys'
import { normalizeDataSource } from '../hooks/config'
import { pageIdFromUrl, parseIssue, parseSchema } from '../hooks/parse'

function issue(over: Partial<Issue>): Issue {
  return {
    pageId: 'p',
    url: 'u',
    title: 't',
    key: null,
    status: '未着手',
    priority: null,
    category: null,
    tags: [],
    start: null,
    end: null,
    owner: null,
    ...over,
  }
}

const SCHEMA: Schema = {
  isWritable: true,
  problem: null,
  tags: [{ name: 'DemoCLI', color: 'purple' }],
  statuses: ['未着手', '進行中', '完了'],
  categories: ['仕事'],
  priorities: ['高', '中', '低'],
  owners: ['AI', '人間'],
}

const DRAFT: Draft = {
  title: 'ヘルプ表示の修正',
  key: 'sek-09',
  tag: 'DemoCLI',
  newTag: '',
  category: '仕事',
  priority: '中',
  owner: '人間',
  start: '2026-10-15',
  end: '2026-10-17',
}

describe('keys', () => {
  test('finds the key in real ticket titles', () => {
    expect(keyFromTitle('【DemoCLI】SEK-08 CLI 挙動の整合')).toBe('SEK-08')
    expect(keyFromTitle('【SampleApp UX-10】ギャラリーの修正')).toBe('UX-10')
    expect(keyFromTitle('【ChatApp】TICKET-24 本番インフラ構築')).toBe('TICKET-24')
    expect(keyFromTitle('utf-8 対応の調査')).toBe(null)
    expect(keyFromTitle('研究案の設計')).toBe(null)
  })

  test('reads the key from a branch name case-insensitively', () => {
    expect(keyFromBranch('feat/sek-08-login')).toBe('SEK-08')
    expect(keyFromBranch('fix/TICKET-24')).toBe('TICKET-24')
    expect(keyFromBranch('main')).toBe(null)
    expect(keyFromBranch('feature/v2-ui')).toBe(null)
  })

  test('reports every issue sharing a key', () => {
    const issues = [issue({ pageId: 'a', key: 'SEK-08' }), issue({ pageId: 'b', key: 'SEK-08' })]
    expect(matchIssues(issues, 'SEK-08').length).toBe(2)
    expect(matchIssues(issues, 'SEK-09').length).toBe(0)
  })

  test('counts today in JST whatever the host timezone', () => {
    expect(todayJst(Date.parse('2026-10-15T14:59:00Z'))).toBe('2026-10-15')
    expect(todayJst(Date.parse('2026-10-15T15:00:00Z'))).toBe('2026-10-16')
  })

  test('the week tab holds overdue issues and those due within seven days', () => {
    const issues = [
      issue({ pageId: 'late', end: '2026-10-10' }),
      issue({ pageId: 'soon', end: '2026-10-22' }),
      issue({ pageId: 'later', end: '2026-10-23' }),
      issue({ pageId: 'none' }),
    ]
    expect(filterTab(issues, 'week', '2026-10-15').map(i => i.pageId)).toEqual(['late', 'soon'])
  })

  test('requires every property of the ticket rule before confirming', () => {
    expect(missingFields(DRAFT, SCHEMA)).toEqual([])
    const empty = { ...DRAFT, title: ' ', tag: '', end: '2026-10-14', owner: '' }
    expect(missingFields(empty, SCHEMA)).toEqual(['件名', '案件タグ', '人間ラベル', '終了日'])
    expect(missingFields({ ...DRAFT, newTag: "a'b" }, SCHEMA)).toEqual(['案件タグ'])
  })

  test('composes the title in the DB convention', () => {
    expect(composeTitle(DRAFT)).toBe('【DemoCLI】SEK-09 ヘルプ表示の修正')
    expect(composeTitle({ ...DRAFT, key: '', newTag: '新案件' })).toBe('【新案件】ヘルプ表示の修正')
  })
})

describe('parse', () => {
  test('reads a rows-mode row, null fields included', () => {
    const row = {
      url: 'https://app.notion.com/p/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb2',
      'タスク/プロジェクト名': '【SampleApp UX-10】ちらつき解消',
      'ステータス': '未着手',
      '案件タグ': '["SampleApp"]',
      '優先順位': null,
      'date:終了日:start': '2026-10-21',
    }
    const parsed = parseIssue(row)
    expect(parsed?.pageId).toBe('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb2')
    expect(parsed?.key).toBe('UX-10')
    expect(parsed?.tags).toEqual(['SampleApp'])
    expect(parsed?.priority).toBe(null)
    expect(parsed?.start).toBe(null)
    expect(parseIssue({ url: null })).toBe(null)
  })

  test('takes the page id from either Notion URL form', () => {
    expect(pageIdFromUrl('https://app.notion.com/ccccccccccccccccccccccccccccccc3')).toBe('ccccccccccccccccccccccccccccccc3')
    expect(pageIdFromUrl('https://app.notion.com/p/ddddddddddddddddddddddddddddddd4?pvs=204')).toBe('ddddddddddddddddddddddddddddddd4')
  })

  test('turns read-only when a property is missing', () => {
    const reply = { text: '<data-source-state>\n{"schema":{"ステータス":{"type":"status"}}}\n</data-source-state>' }
    const schema = parseSchema(reply)
    expect(schema.isWritable).toBe(false)
    expect(schema.problem ?? '').toContain('タスク/プロジェクト名')
  })
})

describe('config', () => {
  test('accepts a collection URL, a database URL or a bare id for the DB', () => {
    const id = '12345678-90ab-4cde-8f01-23456789abcd'
    expect(normalizeDataSource(`collection://${id}`)).toBe(id)
    expect(normalizeDataSource('https://www.notion.so/ws/1234567890ab4cde8f0123456789abcd?v=1')).toBe(id)
    expect(normalizeDataSource('not a db')).toBe('')
  })
})
