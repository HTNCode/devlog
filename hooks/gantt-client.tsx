import type { ClientKeyEvent, ClientModule, ClientPointerEvent, ClientSurface } from 'claude-code'

// Self-contained on purpose: the surface module runs on the drawing thread
// and gets only day offsets, so it needs no date arithmetic or imports.

type Row = { id: string; label: string; start: number; end: number; color: 'error' | 'suggestion' | 'text' }

type Props = {
  days: number
  cellsPerDay: number
  labelWidth: number
  todayOffset: number
  header: string
  rows: Row[]
  selected: string | null
  pending: { id: string; start: number; end: number } | null
}

type Preview = { id: string; startDelta: number; endDelta: number }
type Drag = { id: string; x0: number; isEndOnly: boolean; delta: number }
type State = { index: number; drag: Drag | null; preview: Preview | null }

const HEADER_ROWS = 1

function cell(day: number, start: number, end: number, today: number): string {
  const isBar = day >= start && day <= end
  if (day === today) return isBar ? '▓' : '│'
  return isBar ? '█' : '·'
}

function segments(start: number, end: number, p: Props): [string, string, string] {
  const parts: [string, string, string] = ['', '', '']
  for (let day = 0; day < p.days; day += 1) {
    const slot = day < start ? 0 : day <= end ? 1 : 2
    parts[slot] += cell(day, start, end, p.todayOffset).repeat(p.cellsPerDay)
  }
  return parts
}

function span(row: Row, p: Props, s: State): { start: number; end: number; isChanged: boolean } {
  if (s.preview?.id === row.id) {
    return { start: row.start + s.preview.startDelta, end: row.end + s.preview.endDelta, isChanged: true }
  }
  if (p.pending?.id === row.id) return { start: p.pending.start, end: p.pending.end, isChanged: true }
  return { start: row.start, end: row.end, isChanged: false }
}

function keyHandler(p: Props, s: State, surface: ClientSurface<State>) {
  return (ev: ClientKeyEvent) => {
    const row = p.rows[s.index]
    if (row === undefined) return
    if (ev.key === 'up' || ev.key === 'down') {
      const index = Math.min(p.rows.length - 1, Math.max(0, s.index + (ev.key === 'up' ? -1 : 1)))
      surface.setState({ ...s, index, preview: null })
      surface.post({ type: 'select', id: p.rows[index]?.id ?? row.id })
      return
    }
    if (ev.key === 'left' || ev.key === 'right') {
      const d = ev.key === 'right' ? 1 : -1
      const base = s.preview?.id === row.id ? s.preview : { id: row.id, startDelta: 0, endDelta: 0 }
      surface.setState({ ...s, preview: { id: row.id, startDelta: base.startDelta + (ev.shift ? d : 0), endDelta: base.endDelta + d } })
      return
    }
    if (ev.key === 'return' && s.preview !== null) {
      surface.post({ type: 'propose', ...s.preview })
      surface.setState({ ...s, preview: null })
    }
  }
}

function pressDown(ev: ClientPointerEvent, p: Props, s: State, surface: ClientSurface<State>): void {
  const index = ev.y - HEADER_ROWS
  const row = p.rows[index]
  if (row === undefined) return
  const day = Math.floor((ev.x - p.labelWidth - 1) / p.cellsPerDay)
  const isOnBar = day >= row.start && day <= row.end
  const drag = isOnBar ? { id: row.id, x0: ev.x, isEndOnly: day === row.end && row.end > row.start, delta: 0 } : null
  surface.setState({ index, drag, preview: null })
  surface.post({ type: 'select', id: row.id })
}

function pointerHandler(p: Props, s: State, surface: ClientSurface<State>) {
  return (ev: ClientPointerEvent) => {
    if (ev.type === 'down' && ev.button === 'left') {
      pressDown(ev, p, s, surface)
      return
    }
    const drag = s.drag
    if (drag === null) return
    if (ev.type === 'move') {
      const delta = Math.round((ev.x - drag.x0) / p.cellsPerDay)
      if (delta === drag.delta) return
      const preview = { id: drag.id, startDelta: drag.isEndOnly ? 0 : delta, endDelta: delta }
      surface.setState({ ...s, drag: { ...drag, delta }, preview })
      return
    }
    if (ev.type === 'up') {
      if (drag.delta !== 0 && s.preview !== null) surface.post({ type: 'propose', ...s.preview })
      surface.setState({ ...s, drag: null, preview: null })
    }
  }
}

const Gantt: ClientModule<Props, State> = (p, surface) => {
  const { Box, Text } = surface.elements
  const initial = Math.max(0, p.rows.findIndex(row => row.id === p.selected))
  const s: State = surface.state ?? { index: initial, drag: null, preview: null }
  surface.onKey(keyHandler(p, s, surface))
  surface.onPointer(pointerHandler(p, s, surface))
  return (
    <Box flexDirection="column">
      <Text dimColor>
        {' '.repeat(p.labelWidth + 1)}
        {p.header}
      </Text>
      {p.rows.map((row, i) => {
        const now = span(row, p, s)
        const [before, bar, after] = segments(now.start, now.end, p)
        return (
          <Box key={row.id}>
            <Box width={p.labelWidth + 1}>
              <Text wrap="truncate-end" inverse={i === s.index}>
                {row.label}
              </Text>
            </Box>
            <Text dimColor>{before}</Text>
            <Text color={now.isChanged ? 'warning' : row.color}>{bar}</Text>
            <Text dimColor>{after}</Text>
          </Box>
        )
      })}
    </Box>
  )
}

export default Gantt
