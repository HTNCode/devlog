import type { Issue } from '../types'
import { addDays, isOverdue, STATUS } from './keys'

export type GanttColor = 'error' | 'suggestion' | 'inactive' | 'merged'

// Offsets are whole days from the range's first day, so the Client module
// can draw and drag without any date arithmetic of its own.
export type GanttRow = {
  id: string
  label: string
  start: number
  end: number
  color: GanttColor
}

export type GanttLayout = {
  from: string
  days: number
  cellsPerDay: number
  labelWidth: number
  todayOffset: number
  weekStarts: number[]
}

export type GanttPreview = { id: string; start: number; end: number }

export type GanttModel = GanttLayout & {
  header: string
  dayLine: string | null
  rows: GanttRow[]
  selected: string | null
  pending: GanttPreview | null
}

// One stretch of cells drawn in one style: the bar, the today column (kept
// visible inside a bar too), a week's first day, or an empty day.
export type CellKind = 'bar' | 'barToday' | 'today' | 'week' | 'empty'
export type Run = { kind: CellKind; text: string }

// The label column grows with the pane so titles stay readable, and stops
// where the chart itself would get too short to read.
const LABEL_WIDTHS: ReadonlyArray<readonly [number, number]> = [
  [100, 30],
  [80, 24],
  [60, 18],
]
const NARROW_LABEL_WIDTH = 10
const MAX_DAYS = 42
const MAX_ROWS = 30
const LEAD_DAYS = 3
// Three cells a day leave room for the day of the month under each day.
const DAY_NUMBER_CELLS = 3
const MIN_DAYS_AT_3 = 21
const MIN_DAYS_AT_2 = 14
const DAY_MS = 24 * 60 * 60 * 1000
const MONDAY = 1
const GLYPH: Record<CellKind, string> = { bar: '█', barToday: '▓', today: '│', week: '┊', empty: '·' }

function datePart(value: string): string {
  return value.slice(0, 10)
}

export function dayDiff(from: string, to: string): number {
  const a = Date.parse(`${datePart(from)}T00:00:00Z`)
  const b = Date.parse(`${datePart(to)}T00:00:00Z`)
  return Math.round((b - a) / DAY_MS)
}

export function isTimed(issue: Pick<Issue, 'start' | 'end'>): boolean {
  return (issue.start?.includes('T') ?? false) || (issue.end?.includes('T') ?? false)
}

function labelWidthFor(bodyColumns: number): number {
  return LABEL_WIDTHS.find(([min]) => bodyColumns >= min)?.[1] ?? NARROW_LABEL_WIDTH
}

function cellsPerDayFor(room: number): number {
  if (room >= DAY_NUMBER_CELLS * MIN_DAYS_AT_3) return DAY_NUMBER_CELLS
  return room >= 2 * MIN_DAYS_AT_2 ? 2 : 1
}

export function ganttLayout(bodyColumns: number, today: string): GanttLayout {
  const labelWidth = labelWidthFor(bodyColumns)
  const room = Math.max(1, bodyColumns - labelWidth - 1)
  const cellsPerDay = cellsPerDayFor(room)
  const days = Math.max(1, Math.min(MAX_DAYS, Math.floor(room / cellsPerDay)))
  const lead = Math.min(LEAD_DAYS, Math.floor(days / 4))
  const from = addDays(today, -lead)
  const firstWeekday = new Date(`${from}T00:00:00Z`).getUTCDay()
  const firstMonday = (MONDAY - firstWeekday + 7) % 7
  const weekStarts: number[] = []
  for (let day = firstMonday; day < days; day += 7) weekStarts.push(day)
  return { from, days, cellsPerDay, labelWidth, todayOffset: lead, weekStarts }
}

function colorOf(issue: Issue, today: string): GanttColor {
  if (isOverdue(issue, today)) return 'error'
  if (issue.status === STATUS.doing) return 'suggestion'
  return issue.status === STATUS.todo ? 'inactive' : 'merged'
}

// The key first, then the title without the 【案件】 prefix and the key it
// already showed, so the words that tell tickets apart come early.
export function rowLabel(issue: Pick<Issue, 'key' | 'title'>): string {
  const title = issue.title.replace(/^【[^】]*】\s*/, '')
  if (issue.key === null) return title
  return `${issue.key} ${title.replace(issue.key, '').trim()}`.trim()
}

export function ganttRows(issues: readonly Issue[], today: string, from: string): GanttRow[] {
  return issues
    .filter((issue): issue is Issue & { end: string } => issue.end !== null)
    .sort((a, b) => (a.end < b.end ? -1 : a.end > b.end ? 1 : 0))
    .slice(0, MAX_ROWS)
    .map(issue => {
      const end = dayDiff(from, issue.end)
      const start = Math.min(end, dayDiff(from, issue.start ?? issue.end))
      return { id: issue.pageId, label: rowLabel(issue), start, end, color: colorOf(issue, today) }
    })
}

function kindOf(day: number, start: number, end: number, layout: GanttLayout): CellKind {
  const isBar = day >= start && day <= end
  if (day === layout.todayOffset) return isBar ? 'barToday' : 'today'
  if (isBar) return 'bar'
  return layout.weekStarts.includes(day) ? 'week' : 'empty'
}

// Neighbouring days of one kind merge, so each style is one Text.
export function rowRuns(start: number, end: number, layout: GanttLayout): Run[] {
  const runs: Run[] = []
  for (let day = 0; day < layout.days; day += 1) {
    const kind = kindOf(day, start, end, layout)
    const text = GLYPH[kind].repeat(layout.cellsPerDay)
    const last = runs.at(-1)
    if (last !== undefined && last.kind === kind) last.text += text
    else runs.push({ kind, text })
  }
  return runs
}

function shortDate(day: string): string {
  return `${day.slice(5, 7)}/${day.slice(8, 10)}`
}

// Dates at each week's first day; the first day of the range too when a
// week starts late enough to leave it room.
export function headerLine(layout: GanttLayout): string {
  const width = layout.days * layout.cellsPerDay
  const line = Array.from({ length: width }, () => ' ')
  let freeFrom = 0
  for (const day of [0, ...layout.weekStarts]) {
    const at = day * layout.cellsPerDay
    const text = shortDate(addDays(layout.from, day))
    if (at < freeFrom || at + text.length > width) continue
    for (let i = 0; i < text.length; i += 1) line[at + i] = text[i] ?? ' '
    freeFrom = at + text.length + 1
  }
  return line.join('')
}

// The day of the month under every day, when each day has room for it.
export function dayLine(layout: GanttLayout): string | null {
  if (layout.cellsPerDay < DAY_NUMBER_CELLS) return null
  return Array.from({ length: layout.days }, (_, day) =>
    addDays(layout.from, day).slice(8, 10).padStart(layout.cellsPerDay, ' '),
  ).join('')
}

export function shiftDates(
  start: string | null,
  end: string,
  startDelta: number,
  endDelta: number,
): { toStart: string; toEnd: string } {
  const toStart = addDays(datePart(start ?? end), startDelta)
  const shifted = addDays(datePart(end), endDelta)
  return { toStart, toEnd: shifted < toStart ? toStart : shifted }
}
