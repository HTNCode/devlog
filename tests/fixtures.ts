import type { McpToolResult, On, UiPane } from 'claude-code'

export type Recorded = { tool: string; args: Record<string, unknown> }

export const CREATED_DB = 'collection://11111111-2222-3333-4444-555555555555'

export type FakeNotion = {
  rows: Record<string, unknown>[]
  pageStatus: string
  calls: Recorded[]
  // The origin of every pane close, and the width of every open, when a
  // test wants them.
  closes?: string[]
  opens?: number[]
}

const SCHEMA = {
  schema: {
    'タスク/プロジェクト名': { type: 'title' },
    'ステータス': {
      type: 'status',
      groups: { to_do: [{ name: '未着手' }], in_progress: [{ name: '進行中' }], complete: [{ name: '完了' }] },
    },
    '優先順位': { type: 'select', options: [{ name: '高' }, { name: '中' }, { name: '低' }] },
    'カテゴリー': { type: 'select', options: [{ name: '仕事' }] },
    '案件タグ': {
      type: 'multi_select',
      options: [
        { name: 'DemoCLI', color: 'purple' },
        { name: 'SampleApp', color: 'gray' },
      ],
    },
    '人間ラベル': { type: 'status', groups: { to_do: [{ name: 'AI' }], in_progress: [{ name: '人間' }] } },
    '開始日': { type: 'date' },
    '終了日': { type: 'date' },
  },
}

export function row(id: string, title: string, status: string, end: string): Record<string, unknown> {
  return {
    url: `https://app.notion.com/p/${id}`,
    'タスク/プロジェクト名': title,
    'ステータス': status,
    '案件タグ': '["DemoCLI"]',
    'date:終了日:start': end,
  }
}

function reply(value: unknown): McpToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value) }], isError: false }
}

function answer(fake: FakeNotion, tool: string, args: Record<string, unknown>): McpToolResult {
  if (tool === 'notion-query-data-sources') return reply({ results: fake.rows, has_more: false })
  if (tool === 'notion-fetch' && String(args['id']).startsWith('collection://')) {
    return reply({ text: `<data-source-state>\n${JSON.stringify(SCHEMA)}\n</data-source-state>` })
  }
  if (tool === 'notion-update-data-source') return reply({ text: String(args['statements']) })
  if (tool === 'notion-create-database') return reply({ text: `<data-source url="{{${CREATED_DB}}}">` })
  if (tool === 'notion-fetch') {
    return reply({ text: `<properties>\n${JSON.stringify({ 'ステータス': fake.pageStatus })}\n</properties>` })
  }
  return reply({})
}

// The pane's open state follows ui.open and ui.close, as the engine's own
// record does, so a bare /devlog can toggle.
function trackPane(on: On, fake: FakeNotion): void {
  let isOpen = false
  const pane: UiPane = {
    id: 'devlog',
    title: 'Devlog',
    isShown: true,
    isFocused: false,
    isPlaced: true,
  }
  on('ui.open', (_$, e) => {
    isOpen = true
    fake.opens?.push(e.columns ?? 0)
    return { value: { isPlaced: true as const } }
  })
  on('ui.panes', () => ({ value: isOpen ? [pane] : [] }))
  on('ui.close', (_$, e) => {
    isOpen = false
    fake.closes?.push(e.origin.kind)
    return { value: undefined }
  })
}

// Stands in for the Notion connector and git beneath the plugin, recording
// every call so a test can check what would have been written.
export function fakeNotion(on: On, fake: FakeNotion, branch: string): void {
  fakeHost(on, fake, branch)
  on('mcp.call', (_$, e) => {
    fake.calls.push({ tool: e.tool, args: e.args })
    return { value: answer(fake, e.tool, e.args) }
  })
}

// Everything fakeNotion stands in for but the connector, for a test that
// answers mcp.call itself; fakeAnswer gives fakeNotion's answers.
export function fakeAnswer(fake: FakeNotion, tool: string, args: Record<string, unknown>): McpToolResult {
  return answer(fake, tool, args)
}

export function fakeHost(on: On, fake: FakeNotion, branch: string): void {
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('session.surfaces', () => ({ value: ['terminal' as const] }))
  trackPane(on, fake)
  on('process.run', () => ({
    value: {
      exitCode: 0,
      stdout: `${branch}\n`,
      stderr: '',
      isStdoutTruncated: false,
      isStderrTruncated: false,
    },
  }))
}

// Stands in for the settings menu: a row for each option the plugin saves,
// and every write kept as key=value.
export function fakeConfig(on: On, saved: string[]): void {
  on('config.list', () => ({
    value: ['dataSource', 'server'].map(field => ({
      key: `devlog.${field}`,
      label: field,
      kind: 'text' as const,
      value: '',
      provider: { plugin: 'devlog', tier: 'user' as const },
      isLocked: false,
    })),
  }))
  on('config.set', (_$, e) => {
    saved.push(`${e.key}=${String(e.value)}`)
    return { value: e.value }
  })
}

export const RUN = {
  command: 'devlog',
  origin: { kind: 'composer' as const },
  presentation: { isFullscreen: false, columns: 120 },
}

export const BAND = {
  plugin: 'devlog',
  component: 'AbovePrompt' as const,
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 6,
    bodyColumns: 100,
    scroll: { offset: 0, bodyRows: 6 },
    view: {},
  },
}

// Every test names a DB explicitly: the published manifest ships with none.
export const OPTS = { options: { dataSource: 'collection://00000000-0000-0000-0000-000000000000' } }
