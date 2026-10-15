export type Issue = {
  pageId: string
  url: string
  title: string
  key: string | null
  status: string
  priority: string | null
  category: string | null
  tags: string[]
  start: string | null
  end: string | null
  owner: string | null
}

export type Tab = 'open' | 'week' | 'doing' | 'human'

export type View = 'list' | 'create' | 'gantt'

export type Attachment = { name: string; ref: string; isImage: boolean }

export type Attachments = {
  pageId: string
  items: Attachment[]
  isLoading: boolean
  error: string | null
  path: string
  preview: { name: string; file: string } | null
}

export type TagOption = { name: string; color: string }

export type Schema = {
  isWritable: boolean
  problem: string | null
  tags: TagOption[]
  statuses: string[]
  categories: string[]
  priorities: string[]
  owners: string[]
}

export type Draft = {
  title: string
  key: string
  tag: string
  newTag: string
  category: string
  priority: string
  owner: string
  start: string
  end: string
}

export type Pending =
  | { kind: 'status'; pageId: string; label: string; from: string; to: string; note?: string }
  | { kind: 'create'; draft: Draft }
  | {
      kind: 'dates'
      pageId: string
      label: string
      fromStart: string | null
      fromEnd: string | null
      toStart: string
      toEnd: string
    }
  | { kind: 'upload'; pageId: string; label: string; path: string; name: string; size: number }

export type Load = {
  isLoading: boolean
  isWriting: boolean
  error: string | null
  fetchedAt: number | null
}

export type Branch = { name: string; key: string | null }

export type Summary = { pageId: string; status: 'loading' | 'ready' | 'error'; text: string }

declare module 'claude-code' {
  interface PluginState {
    'notion-backlog': {
      issues: Issue[]
      tab: Tab
      view: View
      selected: string | null
      schema: Schema | null
      draft: Draft | null
      pending: Pending | null
      load: Load
      branch: Branch | null
      attachments: Attachments | null
      summaries: Summary[]
      openSummary: string | null
    }
  }
}
