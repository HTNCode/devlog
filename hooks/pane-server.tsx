import type { EngineInterface } from 'claude-code'

import type { Ui } from './pane-list'
import { setPending } from './state'

// Servers seen with a Notion-shaped tool but not in settings. Each is only
// offered: pressing one asks the shared confirm row, and nothing is sent to
// it before settings list it.
export function serverRow($: EngineInterface, ui: Pick<Ui, 'Box' | 'Text' | 'Button'>, candidates: string[]) {
  if (candidates.length === 0) return null
  const { Box, Text, Button } = ui
  return (
    <Box key="servers" gap={1} flexWrap="wrap">
      <Text dimColor>接続先の候補:</Text>
      {candidates.map(name => (
        <Button
          key={`add-server-${name}`}
          dimColor
          onPress={() => void setPending($, () => ({ kind: 'server' as const, name }))}
        >
          {name} を追加
        </Button>
      ))}
    </Box>
  )
}
