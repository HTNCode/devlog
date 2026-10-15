import type { Issue } from '../types'
import { addDays, isOverdue, STATUS } from './keys'

export type GanttColor = 'error' | 'suggestion' | 'text'

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
}

export type GanttPreview = { id: string; start: number; end: number }

export type GanttModel = GanttLayout & {
  header: string
  rows: GanttRow[]
  selected: string | null
  pending: GanttPreview | null
}

const LABEL_WIDTH = 12
// Inside a multiplexer the pane can sit inline at about 40 columns, so the
// label column and the leading days shrink before the chart breaks.
const NARROW_COLUMNS = 60
const NARROW_LABEL_WIDTH = 8
const MAX_DAYS = 42
const MAX_ROWS = 30
const LEAD_DAYS = 3
const WIDE_DAYS = 21
const DAY_MS = 24 * 60 * 60 * 1000

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

export function ganttLayout(bodyColumns: number, today: string): GanttLayout {
  const labelWidth = bodyColumns < NARROW_COLUMNS ? NARROW_LABEL_WIDTH : LABEL_WIDTH
  const room = Math.max(1, bodyColumns - labelWidth - 1)
  const cellsPerDay = room >= WIDE_DAYS * 2 ? 2 : 1
  const days = Math.max(1, Math.min(MAX_DAYS, Math.floor(room / cellsPerDay)))
  const lead = Math.min(LEAD_DAYS, Math.floor(days / 4))
  return { from: addDays(today, -lead), days, cellsPerDay, labelWidth, todayOffset: lead }
}

function colorOf(issue: Issue, today: string): GanttColor {
  if (isOverdue(issue, today)) return 'error'
  return issue.status === STATUS.doing ? 'suggestion' : 'text'
}

export function ganttRows(issues: readonly Issue[], today: string, from: string): GanttRow[] {
  return issues
    .filter((issue): issue is Issue & { end: string } => issue.end !== null)
    .sort((a, b) => (a.end < b.end ? -1 : a.end > b.end ? 1 : 0))
    .slice(0, MAX_ROWS)
    .map(issue => {
      const end = dayDiff(from, issue.end)
      const start = Math.min(end, dayDiff(from, issue.start ?? issue.end))
      return { id: issue.pageId, label: issue.key ?? issue.title.slice(0, 10), start, end, color: colorOf(issue, today) }
    })
}

function cell(day: number, start: number, end: number, todayOffset: number): string {
  const isBar = day >= start && day <= end
  if (day === todayOffset) return isBar ? '▓' : '│'
  return isBar ? '█' : '·'
}

// Before, bar and after, drawn as three Texts so only the bar takes the color.
export function barSegments(start: number, end: number, layout: GanttLayout): [string, string, string] {
  const parts: [string, string, string] = ['', '', '']
  for (let day = 0; day < layout.days; day += 1) {
    const slot = day < start ? 0 : day <= end ? 1 : 2
    parts[slot] += cell(day, start, end, layout.todayOffset).repeat(layout.cellsPerDay)
  }
  return parts
}

export function headerLine(layout: GanttLayout): string {
  const width = layout.days * layout.cellsPerDay
  const line = Array.from({ length: width }, () => ' ')
  const marks = [0, layout.todayOffset]
  for (let day = layout.todayOffset + 7; day < layout.days; day += 7) marks.push(day)
  let freeFrom = 0
  for (const day of marks) {
    const at = day * layout.cellsPerDay
    const date = addDays(layout.from, day)
    const text = `${date.slice(5, 7)}/${date.slice(8, 10)}`
    if (at < freeFrom || at + text.length > width) continue
    for (let i = 0; i < text.length; i += 1) line[at + i] = text[i] ?? ' '
    freeFrom = at + text.length + 1
  }
  return line.join('')
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
