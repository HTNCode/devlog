import type { Draft, Issue, Schema, Tab } from '../types'
import { CONFIG } from './config'

// The DB has no ID property, so the key is the first token like SEK-08 or
// TICKET-24 in the title. Keys can repeat across 案件タグ, so callers must
// treat more than one match as ambiguous.
const KEY_IN_TITLE = /(?<![A-Za-z0-9])([A-Z][A-Z0-9]*-\d+)(?![A-Za-z0-9])/
const KEY_IN_BRANCH = /(?<![A-Za-z0-9])([A-Za-z][A-Za-z0-9]*-\d+)(?![A-Za-z0-9])/

// The mod environment's local timezone is not guaranteed, and the tickets
// are dated in JST, so "today" is computed from UTC plus nine hours.
const JST_OFFSET_MS = 9 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const WEEK_DAYS = 7

// The option values come from the person's userConfig (config.ts).
export const STATUS = CONFIG.status

export function keyFromTitle(title: string): string | null {
  return KEY_IN_TITLE.exec(title)?.[1] ?? null
}

export function keyFromBranch(branch: string): string | null {
  for (const segment of branch.split('/').reverse()) {
    const found = KEY_IN_BRANCH.exec(segment)?.[1]
    if (found !== undefined) return found.toUpperCase()
  }
  return null
}

export function matchIssues(issues: readonly Issue[], key: string): Issue[] {
  return issues.filter(issue => issue.key === key)
}

export function todayJst(nowMs: number): string {
  return new Date(nowMs + JST_OFFSET_MS).toISOString().slice(0, 10)
}

export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10)
}

export function isValidDate(value: string): boolean {
  return DATE_PATTERN.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
}

export function isOverdue(issue: Issue, today: string): boolean {
  return issue.end !== null && issue.end < today && issue.status !== STATUS.done
}

export function filterTab(issues: readonly Issue[], tab: Tab, today: string): Issue[] {
  const weekEnd = addDays(today, WEEK_DAYS)
  switch (tab) {
    case 'open':
      return [...issues]
    case 'week':
      return issues.filter(issue => issue.end !== null && issue.end <= weekEnd)
    case 'doing':
      return issues.filter(issue => issue.status === STATUS.doing)
    case 'human':
      return issues.filter(issue => issue.owner === CONFIG.humanOwner)
  }
}

export function draftTag(draft: Draft): string {
  return draft.newTag.trim() || draft.tag
}

// Names reach a DDL statement when a new 案件タグ option is added, so quotes
// and control characters are refused rather than escaped.
const UNSAFE_NAME = /['"\\\p{Cc}]/u

export function isSafeName(name: string): boolean {
  return name.length > 0 && name.length <= 100 && !UNSAFE_NAME.test(name)
}

// Every property the user's ticket rule requires must be filled before the
// confirm button appears.
export function missingFields(draft: Draft, schema: Schema): string[] {
  const missing: string[] = []
  const tag = draftTag(draft)
  if (draft.title.trim() === '') missing.push('件名')
  if (!isSafeName(tag)) missing.push('案件タグ')
  if (!schema.categories.includes(draft.category)) missing.push('カテゴリー')
  if (!schema.priorities.includes(draft.priority)) missing.push('優先順位')
  if (!schema.owners.includes(draft.owner)) missing.push('人間ラベル')
  if (!isValidDate(draft.start)) missing.push('開始日')
  if (!isValidDate(draft.end) || draft.end < draft.start) missing.push('終了日')
  return missing
}

export function composeTitle(draft: Draft): string {
  const key = draft.key.trim().toUpperCase()
  return `【${draftTag(draft)}】${key === '' ? '' : `${key} `}${draft.title.trim()}`
}

export function shortDate(date: string | null): string {
  return date === null ? '--/--' : `${date.slice(5, 7)}/${date.slice(8, 10)}`
}
