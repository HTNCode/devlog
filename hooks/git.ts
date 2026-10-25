import type { EngineInterface, On } from 'claude-code'

import type { Issue } from '../types'
import { refresh, refreshBranch } from './actions'
import { keyFromTitle, matchIssues, STATUS } from './keys'
import { getBranch, getIssues, getPending, setPending } from './state'

export type GitEvent = 'commit' | 'merge'

const COMMIT = /(?:^|[\s;&|(])git\s+(?:-C\s+\S+\s+)?commit\b/
const MERGE = /(?:^|[\s;&|(])gh\s+pr\s+merge\b/
// The approval gate asks for every command that uses gh. Telling a merge apart
// within shell syntax kept failing (flags, redirections, here-strings,
// variables and xargs each hid one), so it only looks for the word gh. The
// word is looked for in the command as written, as the shell splits it
// (shellSegments) and with every escape and quote stripped (flatSegments),
// so `g""h`, `g\h` and a line continuation inside gh still count; a further
// reading can only add asks. gh-pages and .github are other words. This
// guards ordinary calls, not gh assembled from pieces (`$a$b`), a decoded
// script or an alias.
const GH_WORD = /(?:^|[^\w-])gh(?![\w-])/
const SEPARATORS = '\n;&|'
export const GH_REASON = 'gh を使うコマンドは人の承認が必要です（devlog）'

export function gitEvent(command: string): GitEvent | null {
  if (MERGE.test(command)) return 'merge'
  return COMMIT.test(command) ? 'commit' : null
}

// A backslash at `at`: a line continuation vanishes, an escaped character is
// kept as text. Inside double quotes the backslash escapes only $ ` " \.
function readEscape(command: string, at: number, quote: string | null): { text: string; next: number } {
  const escaped = command[at + 1]
  if (escaped === undefined) return { text: '\\', next: at + 1 }
  if (escaped === '\n') return { text: '', next: at + 2 }
  if (escaped === '\r' && command[at + 2] === '\n') return { text: '', next: at + 3 }
  const kept = quote === '"' && !'$`"\\'.includes(escaped) ? '\\' : ''
  return { text: kept + escaped, next: at + 2 }
}

// Only a separator outside quotes and not escaped ends a segment, so an
// escaped backslash before a newline (`x\\<newline>gh`) still splits.
// Quotes are dropped.
function shellSegments(command: string): string[] {
  const segments: string[] = []
  let current = ''
  let quote: string | null = null
  let at = 0
  while (at < command.length) {
    const char = command[at] ?? ''
    if (quote === "'") {
      if (char === "'") quote = null
      else current += char
      at++
    } else if (char === '\\') {
      const { text, next } = readEscape(command, at, quote)
      current += text
      at = next
    } else if (char === '"' || char === "'") {
      quote = quote === char ? null : (quote ?? char)
      at++
    } else if (quote === null && SEPARATORS.includes(char)) {
      segments.push(current)
      current = ''
      at++
    } else {
      current += char
      at++
    }
  }
  segments.push(current)
  return segments
}

function flatSegments(command: string): string[] {
  const joined = command.replace(/\\\r?\n/g, '').replace(/\\(.)/g, '$1')
  return joined.replace(/["']/g, '').split(/[\n;&|]/)
}

export function usesGh(input: unknown): boolean {
  if (typeof input !== 'object' || input === null || !('command' in input)) return false
  const command = input.command
  if (typeof command !== 'string') return false
  return [command, ...shellSegments(command), ...flatSegments(command)].some(text => GH_WORD.test(text))
}

// A commit moves an untouched issue to 進行中; a merged PR proposes 完了.
export function targetStatus(event: GitEvent, status: string): string | null {
  if (event === 'merge') return status === STATUS.done ? null : STATUS.done
  return status === STATUS.todo ? STATUS.doing : null
}

// A key typed in the command (a commit message) wins over the branch's, but
// only a key that names exactly one open issue is used; UTF-8 and the like
// match nothing and fall through.
export function pickIssue(issues: readonly Issue[], command: string, branchKey: string | null): Issue | null {
  for (const key of [keyFromTitle(command), branchKey]) {
    if (key === null) continue
    const matches = matchIssues(issues, key)
    if (matches.length === 1 && matches[0] !== undefined) return matches[0]
  }
  return null
}

// The list may still be empty while the session's first load is running,
// so an empty list is loaded once before deciding there is nothing to say.
async function openIssues($: EngineInterface): Promise<Issue[]> {
  const issues = await getIssues($)
  if (issues.length > 0) return issues
  await refresh($)
  return getIssues($)
}

async function suggest($: EngineInterface, event: GitEvent, command: string, branchKey: string | null): Promise<void> {
  const issue = pickIssue(await openIssues($), command, branchKey)
  const to = issue === null ? null : targetStatus(event, issue.status)
  if (issue === null || to === null || (await getPending($)) !== null) return
  const label = issue.key ?? issue.title.slice(0, 20)
  const note = event === 'merge' ? 'PR マージを検知:' : 'コミットを検知:'
  await setPending($, () => ({ kind: 'status' as const, pageId: issue.pageId, label, from: issue.status, to, note }))
  $.ui.toast(`${note} ${label} を「${to}」にしますか。帯の確定ボタンで反映します`)
}

// Watches only the Bash calls Claude makes; it never changes them, so a
// failure here passes the call through untouched.
export function registerGit(on: On): void {
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const event = gitEvent(e.command)
    if (event === null) return next(e)
    // Read before running: `gh pr merge --delete-branch` switches branches.
    const branchKey = (await getBranch($))?.key ?? null
    const ran = await next(e)
    if (ran.deny === undefined && ran.isError !== true) {
      await suggest($, event, e.command, branchKey).catch(() => undefined)
      void refreshBranch($)
    }
    return ran
  }).catch(($, e, next) => next(e))

  // gh can merge a PR, which proposes 完了, so even in auto mode a person
  // approves every gh call: `decider: 'person'` is settled by no classifier's
  // allow, and is a deny where nobody can be asked. A deny beneath still stands.
  on('tool.check', { tool: 'Bash' }, async ($, e, next) => {
    const verdict = await next(e)
    if (verdict.decision === 'deny' || !usesGh(e.input)) return verdict
    return { decision: 'ask', decider: 'person', reason: GH_REASON }
  }).catch(($, e, next) => (usesGh(e.input) ? { decision: 'deny', reason: GH_REASON } : next(e)))
}
