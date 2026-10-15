import type { EngineInterface } from 'claude-code'

import type { Issue, Pending } from '../types'
import { isTimed, shiftDates } from './gantt'
import { callJson, readPage } from './notion'
import { PROP } from './parse'
import { getPending, setPending } from './state'

type DatesPending = Extract<Pending, { kind: 'dates' }>

// A second press on the same issue builds on the change still waiting for
// confirm, so +1 twice proposes +2 against the dates Notion last showed.
export async function proposeDates($: EngineInterface, issue: Issue, startDelta: number, endDelta: number): Promise<void> {
  if (issue.end === null) {
    $.ui.toast('期限の無い課題は Notion で日付を入れてください')
    return
  }
  if (isTimed(issue)) {
    $.ui.toast('時刻付きの日付は Notion で変更してください')
    return
  }
  const pending = await getPending($)
  const base = pending?.kind === 'dates' && pending.pageId === issue.pageId ? pending : null
  const { toStart, toEnd } = shiftDates(base?.toStart ?? issue.start, base?.toEnd ?? issue.end, startDelta, endDelta)
  const next: DatesPending = {
    kind: 'dates',
    pageId: issue.pageId,
    label: issue.key ?? issue.title.slice(0, 20),
    fromStart: issue.start,
    fromEnd: issue.end,
    toStart,
    toEnd,
  }
  await setPending($, () => next)
}

// Re-reads the page first: a date someone changed in Notion since the chart
// was drawn is reported, never overwritten.
export async function confirmDates($: EngineInterface, pending: DatesPending): Promise<string> {
  const page = await readPage($, pending.pageId)
  if (page.start !== pending.fromStart || page.end !== pending.fromEnd) {
    return `${pending.label} は Notion 側で期間が変わっていたため、上書きしませんでした`
  }
  await callJson($, 'notion-update-page', {
    page_id: pending.pageId,
    command: 'update_properties',
    properties: {
      [`date:${PROP.start}:start`]: pending.toStart,
      [`date:${PROP.start}:is_datetime`]: 0,
      [`date:${PROP.end}:start`]: pending.toEnd,
      [`date:${PROP.end}:is_datetime`]: 0,
    },
    allow_async: false,
  })
  return `${pending.label} の期間を ${pending.toStart}〜${pending.toEnd} にしました`
}
