import type { Elements, EngineInterface } from 'claude-code'

import type { Attachments, Issue, Load, Pending, Schema, Summary, Tab } from '../types'
import { cancelPending, confirmPending, refresh, selectIssue } from './actions'
import { openAttachments } from './attach'
import { CONFIG } from './config'
import { filterTab, isOverdue, shortDate } from './keys'
import type { AttachUi } from './pane-attach'
import { attachSection } from './pane-attach'
import { setPending, setTab, setView } from './state'
import { summaryBlock } from './pane-summary'
import { closePane, toggleSummary } from './summary'
import { startWork } from './work'

export type Ui = Pick<Elements['terminal'], 'Box' | 'Text' | 'Button' | 'Link' | 'Input' | 'Select'>

export type ListData = {
  issues: Issue[]
  tab: Tab
  selected: string | null
  schema: Schema | null
  pending: Pending | null
  load: Load
  today: string
  attachments: Attachments | null
  summaries: Summary[]
  openSummary: string | null
}

const TABS: ReadonlyArray<readonly [Tab, string]> = [
  ['open', '未完了'],
  ['week', '今週期限'],
  ['doing', '進行中'],
  ['human', ''],
]

export function loadLine(load: Load, schema: Schema | null): string | null {
  if (load.isWriting) return 'Notion に書き込み中...'
  if (load.isLoading) return '読み込み中...'
  if (load.error !== null) return `読み込みに失敗しました: ${load.error}`
  if (schema !== null && !schema.isWritable) return `読み取り専用: ${schema.problem ?? ''}`
  return null
}

function describe(pending: Pending): string {
  switch (pending.kind) {
    case 'status':
      return `${pending.note === undefined ? '' : `${pending.note} `}${pending.label}: ${pending.from} → ${pending.to}`
    case 'create':
      return `起票: ${pending.draft.title.trim()}`
    case 'dates':
      return `${pending.label}: ${shortDate(pending.fromStart)}〜${shortDate(pending.fromEnd)} → ${shortDate(pending.toStart)}〜${shortDate(pending.toEnd)}`
    case 'upload':
      return `添付: ${pending.name} (${Math.ceil(pending.size / 1024)} KB) → ${pending.label}`
    case 'setup':
      return `Notion に課題 DB「${pending.title}」を作成（${pending.parentId === null ? 'ワークスペース直下・非公開' : `ページ ${pending.parentId} の下`}）`
  }
}

export function confirmRow($: EngineInterface, ui: Pick<Ui, 'Box' | 'Text' | 'Button'>, pending: Pending) {
  const { Box, Text, Button } = ui
  const what = describe(pending)
  return (
    <Box key="confirm" gap={1}>
      <Text color="warning" wrap="truncate-end">
        {what}
      </Text>
      <Button key="confirm-yes" variant="primary" hotkey="y" onPress={() => void confirmPending($)}>
        確定
      </Button>
      <Button key="confirm-no" hotkey="x" onPress={() => void cancelPending($)}>
        取消
      </Button>
    </Box>
  )
}

function detail($: EngineInterface, ui: AttachUi, issue: Issue, data: ListData) {
  const { Box, Text, Button, Link } = ui
  const isWritable = data.schema?.isWritable === true
  const targets = (data.schema?.statuses ?? []).filter(status => status !== issue.status)
  const label = issue.key ?? issue.title.slice(0, 20)
  const ask = (to: string) =>
    setPending($, () => ({ kind: 'status' as const, pageId: issue.pageId, label, from: issue.status, to }))
  return (
    <Box key={`detail-${issue.pageId}`} flexDirection="column" paddingX={2}>
      <Text dimColor wrap="truncate-end">
        {issue.tags.join(', ') || '案件タグなし'} / {issue.priority ?? '-'} / {issue.owner ?? '-'} /{' '}
        {shortDate(issue.start)}〜{shortDate(issue.end)}
      </Text>
      <Box gap={1} flexWrap="wrap">
        <Link href={issue.url} label="Notion で開く" />
        {/* A multiplexer may drop terminal hyperlinks; the clipboard still works. */}
        <Button key={`copy-${issue.pageId}`} dimColor hotkey="c" onPress={() => void $.ui.copy({ text: issue.url })}>
          URLコピー
        </Button>
        <Button key={`work-${issue.pageId}`} hotkey="w" onPress={() => void startWork($, issue)}>
          着手
        </Button>
        <Button key={`attach-${issue.pageId}`} dimColor hotkey="a" onPress={() => void openAttachments($, issue)}>
          添付
        </Button>
        {isWritable &&
          targets.map(status => (
            <Button key={`to-${issue.pageId}-${status}`} dimColor onPress={() => void ask(status)}>
              {status}
            </Button>
          ))}
      </Box>
      {attachSection($, ui, issue, data.attachments?.pageId === issue.pageId ? data.attachments : null)}
    </Box>
  )
}

// Pressing (or Enter on) a row selects it; pressing the selected row again
// opens its summary. The ▸ toggle opens or closes the summary directly.
function row($: EngineInterface, ui: AttachUi, issue: Issue, data: ListData) {
  const { Box, Text, Button } = ui
  const isSelected = data.selected === issue.pageId
  const isOpen = data.openSummary === issue.pageId
  const late = isOverdue(issue, data.today) ? '期限切れ ' : ''
  const press = () => void (isSelected ? toggleSummary($, issue) : selectIssue($, issue.pageId))
  const toggle = () => void selectIssue($, issue.pageId).then(() => toggleSummary($, issue))
  return (
    <Box key={`row-${issue.pageId}`} flexDirection="column">
      <Box gap={1}>
        <Button key={`sum-${issue.pageId}`} plain onPress={toggle}>
          {isOpen ? '▾' : '▸'}
        </Button>
        <Button key={`sel-${issue.pageId}`} plain onPress={press}>
          <Text color="success" bold={isSelected}>
            {late}
            {shortDate(issue.end)} [{issue.status}] {issue.title}
          </Text>
        </Button>
      </Box>
      {isOpen && summaryBlock($, ui, issue, data.summaries.find(one => one.pageId === issue.pageId))}
      {isSelected && detail($, ui, issue, data)}
    </Box>
  )
}

export function listView($: EngineInterface, ui: AttachUi, data: ListData, openCreate: () => void) {
  const { Box, Text, Button } = ui
  const shown = filterTab(data.issues, data.tab, data.today)
  const status = loadLine(data.load, data.schema)
  return (
    <Box flexDirection="column">
      <Box gap={1} flexWrap="wrap">
        {TABS.map(([tab, name], index) => (
          <Button
            key={`tab-${tab}`}
            hotkey={String(index + 1)}
            variant={tab === data.tab ? 'primary' : undefined}
            onPress={() => void setTab($, () => tab)}
          >
            {tab === 'human' ? CONFIG.humanOwner : name}
          </Button>
        ))}
        <Button key="tab-gantt" hotkey="g" onPress={() => void setView($, () => 'gantt' as const)}>
          ガント
        </Button>
        <Button key="refresh" dimColor hotkey="r" onPress={() => void refresh($, true)}>
          更新
        </Button>
        {data.schema?.isWritable === true && (
          <Button key="create" dimColor hotkey="n" onPress={openCreate}>
            起票
          </Button>
        )}
        <Button key="close" dimColor hotkey="q" onPress={() => void closePane($)}>
          閉じる
        </Button>
      </Box>
      {status !== null && <Text dimColor>{status}</Text>}
      {data.pending !== null && data.pending.kind !== 'create' && confirmRow($, ui, data.pending)}
      {shown.length === 0 && !data.load.isLoading && <Text dimColor>該当する課題はありません</Text>}
      {shown.map(issue => row($, ui, issue, data))}
    </Box>
  )
}
