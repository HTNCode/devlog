import type { Elements, EngineInterface, On } from 'claude-code'

import type { Issue, Pending } from '../types'
import type { GanttModel, GanttRow } from './gantt'
import { barSegments, dayDiff, ganttLayout, ganttRows, headerLine } from './gantt'
import { proposeDates } from './gantt-actions'
import { todayJst } from './keys'
import { confirmRow, loadLine } from './pane-list'
import { getIssues, getLoad, getPending, getSchema, getSelected, getView, PANE, setSelected, setView } from './state'
import { closePane } from './summary'

type BaseUi = Pick<Elements['terminal'], 'Box' | 'Text' | 'Button'>

const MAX_DELTA = 365

async function buildModel($: EngineInterface, bodyColumns: number, issues: Issue[]): Promise<GanttModel> {
  const today = todayJst(await $.clock.now())
  const layout = ganttLayout(bodyColumns, today)
  const rows = ganttRows(issues, today, layout.from)
  const pending = await getPending($)
  const stored = await getSelected($)
  const selected = rows.some(row => row.id === stored) ? stored : (rows[0]?.id ?? null)
  const preview =
    pending?.kind === 'dates'
      ? { id: pending.pageId, start: dayDiff(layout.from, pending.toStart), end: dayDiff(layout.from, pending.toEnd) }
      : null
  return { ...layout, header: headerLine(layout), rows, selected, pending: preview }
}

function textRow($: EngineInterface, ui: BaseUi, row: GanttRow, model: GanttModel) {
  const { Box, Text, Button } = ui
  const now = model.pending?.id === row.id ? model.pending : row
  const [before, bar, after] = barSegments(now.start, now.end, model)
  return (
    <Box key={`grow-${row.id}`}>
      <Button key={`gsel-${row.id}`} plain onPress={() => void setSelected($, () => row.id)}>
        {model.selected === row.id ? '>' : ' '}
      </Button>
      <Box width={model.labelWidth}>
        <Text wrap="truncate-end">{row.label}</Text>
      </Box>
      <Text dimColor>{before}</Text>
      <Text color={now === row ? row.color : 'warning'}>{bar}</Text>
      <Text dimColor>{after}</Text>
    </Box>
  )
}

function textChart($: EngineInterface, ui: BaseUi, model: GanttModel) {
  const { Box, Text } = ui
  return (
    <Box flexDirection="column">
      <Text dimColor>
        {' '.repeat(model.labelWidth + 1)}
        {model.header}
      </Text>
      {model.rows.map(row => textRow($, ui, row, model))}
    </Box>
  )
}

// Every operation has a Button with a hotkey, so the chart is fully usable
// where the Client gets no mouse or focus (a multiplexer such as herdr).
// 'y' and 'x' stay free for the shared confirm row.
function controls($: EngineInterface, ui: BaseUi, issue: Issue | undefined, model: GanttModel) {
  const { Box, Text, Button } = ui
  const index = model.rows.findIndex(row => row.id === model.selected)
  const step = (d: number) => {
    const target = model.rows[Math.min(model.rows.length - 1, Math.max(0, index + d))]
    if (target !== undefined) void setSelected($, () => target.id)
  }
  const shift = (startDelta: number, endDelta: number) => {
    if (issue !== undefined) void proposeDates($, issue, startDelta, endDelta)
  }
  return (
    <Box key="gantt-controls" flexDirection="column">
      <Text dimColor wrap="truncate-end">
        選択中: {issue === undefined ? 'なし' : (issue.key ?? issue.title)}
      </Text>
      <Box gap={1} flexWrap="wrap">
        <Button key="gantt-prev" dimColor hotkey="k" onPress={() => step(-1)}>前へ</Button>
        <Button key="gantt-next" dimColor hotkey="j" onPress={() => step(1)}>次へ</Button>
        <Button key="date-end-minus" hotkey="h" onPress={() => shift(0, -1)}>期限 -1日</Button>
        <Button key="date-end-plus" hotkey="l" onPress={() => shift(0, 1)}>期限 +1日</Button>
        <Button key="date-move-minus" hotkey="b" onPress={() => shift(-1, -1)}>期間 -1日</Button>
        <Button key="date-move-plus" hotkey="f" onPress={() => shift(1, 1)}>期間 +1日</Button>
      </Box>
    </Box>
  )
}

function isSmallInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && Math.abs(value) <= MAX_DELTA
}

// What the Client posts is checked field by field: it is data from the
// drawing thread, and only a select or a bounded day shift is accepted.
async function handleMessage($: EngineInterface, data: unknown): Promise<void> {
  if (typeof data !== 'object' || data === null) return
  const type = Reflect.get(data, 'type')
  const id = Reflect.get(data, 'id')
  if (typeof id !== 'string') return
  const issue = (await getIssues($)).find(one => one.pageId === id)
  if (issue === undefined) return
  await setSelected($, () => id)
  const startDelta = Reflect.get(data, 'startDelta')
  const endDelta = Reflect.get(data, 'endDelta')
  if (type === 'propose' && isSmallInt(startDelta) && isSmallInt(endDelta)) {
    await proposeDates($, issue, startDelta, endDelta)
  }
}

function showsConfirm(pending: Pending | null): pending is Pending {
  return pending !== null && pending.kind !== 'create'
}

export function registerGantt(on: On): void {
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    if ((await getView($)) !== 'gantt') return next(e)
    const issues = await getIssues($)
    const model = await buildModel($, e.props.bodyColumns, issues)
    const pending = await getPending($)
    const status = loadLine(await getLoad($), await getSchema($))
    const issue = issues.find(one => one.pageId === model.selected)
    const ui = $.ui.resolve(e)
    const { Box, Text, Button } = ui
    let chart = textChart($, ui, model)
    if (e.surface === 'terminal' || e.surface === 'desktop') {
      const { Client } = $.ui.resolve(e)
      chart = <Client key="gantt" module="./gantt-client.tsx" props={model} />
    }
    return (
      <Box flexDirection="column">
        <Box gap={1}>
          <Button key="gantt-back" dimColor hotkey="g" onPress={() => void setView($, () => 'list' as const)}>
            一覧へ
          </Button>
          <Button key="gantt-close" dimColor hotkey="q" onPress={() => void closePane($)}>
            閉じる
          </Button>
          <Text dimColor wrap="truncate-end">
            クリックで選択、左右キーで期限、shift+左右で期間、Enter で提案
          </Text>
        </Box>
        {status !== null && <Text dimColor>{status}</Text>}
        {model.rows.length === 0 ? <Text dimColor>期限の入った未完了の課題がありません</Text> : chart}
        {model.rows.length > 0 && controls($, ui, issue, model)}
        {showsConfirm(pending) && confirmRow($, ui, pending)}
      </Box>
    )
  })

  on('ui.message', async ($, e) => {
    if (e.element === 'gantt') await handleMessage($, e.data)
    return {}
  })
}
