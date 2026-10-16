import type { Elements, EngineInterface } from 'claude-code'

import type { GanttModel, GanttRow, Run } from './gantt'
import { rowRuns } from './gantt'
import { STATUS } from './keys'
import { setSelected } from './state'

export type BaseUi = Pick<Elements['terminal'], 'Box' | 'Text' | 'Button'>

// The same styles the Client module draws with, for surfaces without one.
function runTexts(ui: BaseUi, key: string, runs: Run[], barColor: string) {
  const { Text } = ui
  return runs.map((run, index) => {
    const isBar = run.kind === 'bar' || run.kind === 'barToday'
    const color = run.kind === 'today' ? 'claude' : isBar ? barColor : undefined
    return (
      <Text key={`${key}-${index}`} color={color} dimColor={!isBar && run.kind !== 'today'}>
        {run.text}
      </Text>
    )
  })
}

function textRow($: EngineInterface, ui: BaseUi, row: GanttRow, model: GanttModel) {
  const { Box, Text, Button } = ui
  const now = model.pending?.id === row.id ? model.pending : row
  return (
    <Box key={`grow-${row.id}`}>
      <Button key={`gsel-${row.id}`} plain onPress={() => void setSelected($, () => row.id)}>
        {model.selected === row.id ? '>' : ' '}
      </Button>
      <Box width={model.labelWidth}>
        <Text wrap="truncate-end" color={row.color === 'error' ? 'error' : undefined}>
          {row.label}
        </Text>
      </Box>
      {runTexts(ui, row.id, rowRuns(now.start, now.end, model), now === row ? row.color : 'warning')}
    </Box>
  )
}

export function textChart($: EngineInterface, ui: BaseUi, model: GanttModel) {
  const { Box, Text } = ui
  const pad = ' '.repeat(model.labelWidth + 1)
  return (
    <Box flexDirection="column">
      <Text dimColor>
        {pad}
        {model.header}
      </Text>
      {model.dayLine !== null && (
        <Text dimColor>
          {pad}
          {model.dayLine}
        </Text>
      )}
      {model.rows.map(row => textRow($, ui, row, model))}
    </Box>
  )
}

export function legend(ui: BaseUi) {
  const { Box, Text } = ui
  return (
    <Box key="gantt-legend" gap={2} flexWrap="wrap">
      <Text color="suggestion">■ {STATUS.doing}</Text>
      <Text color="inactive">■ {STATUS.todo}</Text>
      <Text color="merged">■ その他</Text>
      <Text color="error">■ 期限切れ</Text>
      <Text color="warning">■ 変更案</Text>
      <Text color="claude">│ 今日</Text>
      <Text dimColor>┊ 週の始まり</Text>
    </Box>
  )
}
