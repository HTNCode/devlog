import { describe, expect, mock, test } from 'claude-code/testing'
import type { McpToolResult, On } from 'claude-code'

import { attachmentMarkdown, isSafeUploadPath, parseAttachments, sanitizeFileName, withSuffix } from '../hooks/attach-files'
import { row, RUN } from './fixtures'
import { OPTS } from './fixtures'

const NOW = Date.parse('2026-10-15T03:00:00Z')
const SEK = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1'
const REF = 'notion-file-block://aaaa/bbbb?space_id=cccc&name=%E8%A8%AD%E8%A8%88.png'
const UPLOAD_ID = '00000000-0000-4000-8000-000000000001'

const SCHEMA = {
  schema: {
    'タスク/プロジェクト名': { type: 'title' },
    'ステータス': { type: 'status', groups: { to_do: [{ name: '未着手' }], in_progress: [{ name: '進行中' }] } },
    '優先順位': { type: 'select', options: [{ name: '中' }] },
    'カテゴリー': { type: 'select', options: [{ name: '仕事' }] },
    '案件タグ': { type: 'multi_select', options: [{ name: 'DemoCLI', color: 'purple' }] },
    '人間ラベル': { type: 'status', groups: { in_progress: [{ name: '人間' }] } },
    '開始日': { type: 'date' },
    '終了日': { type: 'date' },
  },
}

const PANE = {
  plugin: 'notion-backlog',
  component: 'Pane' as const,
  requestId: 'notion-backlog',
  surface: 'terminal' as const,
  props: {
    title: 'Devlog',
    isFocused: true,
    bodyColumns: 64,
    placement: 'dock' as const,
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
}

function reply(value: unknown): McpToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value) }], isError: false }
}

function answer(tool: string, args: Record<string, unknown>): unknown {
  if (tool === 'notion-query-data-sources') return { results: [row(SEK, '【DemoCLI】SEK-08 CLI 挙動', '進行中', '2026-10-20')] }
  if (tool === 'notion-fetch' && String(args['id']).startsWith('collection://')) {
    return { text: `<data-source-state>\n${JSON.stringify(SCHEMA)}\n</data-source-state>` }
  }
  if (tool === 'notion-fetch') {
    return { text: `<properties>\n{"ステータス":"進行中"}\n</properties>\n<content>\n本文\n<file src="${REF}"></file>\n</content>` }
  }
  if (tool === 'notion-create-file-upload') {
    return {
      upload_url: `https://api.notion.com/v1/mcp/file_uploads/${UPLOAD_ID}/send`,
      upload_headers: { authorization: 'Bearer short-lived' },
      upload_form_field: 'file',
    }
  }
  return {}
}

// Every call the plugin makes outward lands in one ordered log.
function fake(on: On, log: string[]): void {
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  on('mcp.call', (_$, e) => {
    log.push(`mcp:${e.tool}`)
    return { value: reply(answer(e.tool, e.args)) }
  })
  on('fs.stat', (_$, e) => ({ value: { kind: 'file' as const, size: 2048, mtimeMs: 0, isLink: false, realPath: e.path } }))
  on('process.run', (_$, e) => {
    log.push(`run:${e.argv.join(' ')}`)
    const stdout = e.argv[0] === 'curl' ? JSON.stringify({ suggested_markdown: `<file src="file-upload://${UPLOAD_ID}"></file>` }) : 'main\n'
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
}

describe('attach-files', () => {
  test('lists file references with decoded names', () => {
    const items = parseAttachments(`a <file src="${REF}"></file> b ${REF}`)
    expect(items).toEqual([{ name: '設計.png', ref: REF, isImage: true }])
  })

  test('keeps a saved name inside its folder', () => {
    expect(sanitizeFileName('../../etc/passwd')).toBe('passwd')
    expect(sanitizeFileName('..\\x\\.bashrc')).toBe('bashrc')
    expect(sanitizeFileName('a\u0007b.txt')).toBe('ab.txt')
    expect(sanitizeFileName('...')).toBe('file')
    expect(withSuffix('report.pdf', 2)).toBe('report-2.pdf')
  })

  test('refuses paths curl -F would read as form syntax', () => {
    expect(isSafeUploadPath('/tmp/shot.png')).toBe(true)
    expect(isSafeUploadPath('/tmp/a.png;type=text/html')).toBe(false)
    expect(isSafeUploadPath('/tmp/a.png,b.png')).toBe(false)
    expect(isSafeUploadPath('/tmp/"a".png')).toBe(false)
    expect(isSafeUploadPath('/tmp/a\n.png')).toBe(false)
  })

  test('appends only the block Notion suggested', () => {
    expect(attachmentMarkdown({ suggested_markdown: `<file src="file-upload://${UPLOAD_ID}"></file>` })).toBe(
      `<file src="file-upload://${UPLOAD_ID}"></file>`,
    )
    expect(attachmentMarkdown({ suggested_markdown: '# injected', markdown_source: 'javascript:x' })).toBe(null)
  })
})

test('uploads only after confirm, in create, curl, insert order', OPTS, async ($, on) => {
  mock.clock(on, { now: NOW })
  const log: string[] = []
  fake(on, log)
  await $.command.run({ ...RUN, args: 'refresh' })
  const ui = await $.ui.mount(PANE)
  await ui.press({ key: `sel-${SEK}` })
  await ui.press({ key: `attach-${SEK}` })
  expect((await ui.find({ type: 'Text', text: /設計\.png/ }))?.text ?? '').toContain('[画像]')
  await ui.input({ key: 'attach-path', text: '/work/shot.png', kind: 'change' })
  await ui.press({ key: 'attach-upload' })
  expect(log.some(entry => entry.startsWith('run:curl'))).toBe(false)
  const start = log.length
  await ui.press({ key: 'confirm-yes' })
  const after = log.slice(start).filter(entry => !entry.startsWith('mcp:notion-fetch') && !entry.startsWith('mcp:notion-query'))
  expect(after[0]).toBe('mcp:notion-create-file-upload')
  expect(after[1] ?? '').toContain('run:curl -sS --fail-with-body -X POST -H authorization: Bearer short-lived -F file=@/work/shot.png')
  expect(after[2]).toBe('mcp:notion-update-page')
  await ui.unmount()
})

test('a path with form syntax never reaches the confirm row', OPTS, async ($, on) => {
  mock.clock(on, { now: NOW })
  const log: string[] = []
  fake(on, log)
  await $.command.run({ ...RUN, args: 'refresh' })
  const ui = await $.ui.mount(PANE)
  await ui.press({ key: `sel-${SEK}` })
  await ui.press({ key: `attach-${SEK}` })
  await ui.input({ key: 'attach-path', text: '/work/a.png;type=text/html', kind: 'change' })
  await ui.press({ key: 'attach-upload' })
  expect(await ui.find({ key: 'confirm-yes' })).toBe(undefined)
  expect(log.some(entry => entry === 'mcp:notion-create-file-upload')).toBe(false)
  await ui.unmount()
})
