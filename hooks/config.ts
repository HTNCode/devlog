import type { PluginOptions } from 'claude-code'

// Everything that names one person's Notion DB: the MCP server that reaches
// it, its data source, its property names and the option values the mod
// reads. Filled from the manifest's userConfig on every (re)load; the keys
// here must match the userConfig field names in .claude-plugin/plugin.json.
const DEFAULTS = {
  server: 'claude.ai Notion',
  propTitle: 'タスク/プロジェクト名',
  propStatus: 'ステータス',
  propPriority: '優先順位',
  propCategory: 'カテゴリー',
  propTags: '案件タグ',
  propOwner: '人間ラベル',
  propStart: '開始日',
  propEnd: '終了日',
  statusTodo: '未着手',
  statusDoing: '進行中',
  statusDone: '完了',
  ownerHuman: '人間',
} as const

export const CONFIG = {
  server: DEFAULTS.server as string,
  dataSource: '',
  prop: {
    title: DEFAULTS.propTitle as string,
    status: DEFAULTS.propStatus as string,
    priority: DEFAULTS.propPriority as string,
    category: DEFAULTS.propCategory as string,
    tags: DEFAULTS.propTags as string,
    owner: DEFAULTS.propOwner as string,
    start: DEFAULTS.propStart as string,
    end: DEFAULTS.propEnd as string,
  },
  status: { todo: DEFAULTS.statusTodo as string, doing: DEFAULTS.statusDoing as string, done: DEFAULTS.statusDone as string },
  humanOwner: DEFAULTS.ownerHuman as string,
}

// Accepts a collection:// URL, a database URL or a bare id, dashed or not.
const UUID = /([0-9a-f]{8})-?([0-9a-f]{4})-?([0-9a-f]{4})-?([0-9a-f]{4})-?([0-9a-f]{12})/i

function text(options: PluginOptions, key: keyof typeof DEFAULTS): string {
  const value = options[key]
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : DEFAULTS[key]
}

export function normalizeDataSource(raw: string): string {
  const parts = UUID.exec(raw)
  return parts === null ? '' : parts.slice(1, 6).join('-').toLowerCase()
}

// The prop and status objects are updated in place: other modules hold
// references to them (parse.ts exports CONFIG.prop as PROP).
export function configure(options: PluginOptions): void {
  const source = options['dataSource']
  CONFIG.server = text(options, 'server')
  CONFIG.dataSource = typeof source === 'string' ? normalizeDataSource(source) : ''
  Object.assign(CONFIG.prop, {
    title: text(options, 'propTitle'),
    status: text(options, 'propStatus'),
    priority: text(options, 'propPriority'),
    category: text(options, 'propCategory'),
    tags: text(options, 'propTags'),
    owner: text(options, 'propOwner'),
    start: text(options, 'propStart'),
    end: text(options, 'propEnd'),
  })
  Object.assign(CONFIG.status, {
    todo: text(options, 'statusTodo'),
    doing: text(options, 'statusDoing'),
    done: text(options, 'statusDone'),
  })
  CONFIG.humanOwner = text(options, 'ownerHuman')
}

export function isConfigured(): boolean {
  return CONFIG.dataSource !== ''
}

export function dataSourceUrl(): string {
  return `collection://${CONFIG.dataSource}`
}

export const NOT_CONFIGURED =
  'Notion の DB が未設定です。/config で notion-backlog の dataSource に DB の URL か ID を入れてください'
