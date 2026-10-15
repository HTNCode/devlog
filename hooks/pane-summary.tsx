import type { EngineInterface } from 'claude-code'

import type { Issue, Summary } from '../types'
import type { Ui } from './pane-list'
import { closeSummary } from './summary'

// Drawn under a row while its summary is open.
export function summaryBlock($: EngineInterface, ui: Pick<Ui, 'Box' | 'Text' | 'Button'>, issue: Issue, summary: Summary | undefined) {
  const { Box, Text, Button } = ui
  const lines = summary === undefined || summary.status === 'loading' ? ['要約を作成中...'] : summary.text.split('\n')
  return (
    <Box key={`summary-${issue.pageId}`} flexDirection="column" paddingX={2}>
      {lines.map((line, index) => (
        <Text key={`summary-${issue.pageId}-${index}`} color={summary?.status === 'error' ? 'warning' : 'success'} wrap="wrap">
          {line}
        </Text>
      ))}
      <Button key={`summary-close-${issue.pageId}`} dimColor onPress={() => void closeSummary($)}>
        要約を閉じる (Esc)
      </Button>
    </Box>
  )
}
