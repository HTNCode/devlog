import type { EngineInterface, On } from 'claude-code'

import type { Issue } from '../types'
import { refresh, refreshBranch } from './actions'
import { keyFromTitle, matchIssues, STATUS } from './keys'
import { getBranch, getIssues, getPending, setPending } from './state'

export type GitEvent = 'commit' | 'merge'

const COMMIT = /(?:^|[\s;&|(])git\s+(?:-C\s+\S+\s+)?commit\b/
const MERGE = /(?:^|[\s;&|(])gh\s+pr\s+merge\b/
// The approval gate errs towards asking. It reads the command as the shell
// would join it: a line continuation is removed outright (`mer\<newline>ge`
// runs merge), a backslash escape keeps its character (`m\erge`) and quotes
// are dropped (`mer""ge`); then each segment between separators: flags may
// sit between gh, pr and merge (`gh -R o/r pr merge`), and the REST merge
// endpoint counts too, while `gh pr view && git merge` is no merge. A gh pr
// or gh api segment built from an expansion (`$m`, a backtick, eval, braces)
// cannot be read, so it is asked too. This guards ordinary calls, not a
// decoded script or a gh alias.
const GH = /(?:^|[^\w-])gh\b/
const MERGE_GATES = [
  /(?:^|[^\w-])gh\b.*?\bpr\b.*?\bmerge\b/,
  /(?:^|[^\w-])gh\b.*?\bapi\b.*?\bpulls\/\d+\/merge\b/,
]
const OPAQUE = /\$|`|\{|\beval\b/
export const MERGE_REASON = 'gh pr merge は人の承認が必要です（devlog）'

export function gitEvent(command: string): GitEvent | null {
  if (MERGE.test(command)) return 'merge'
  return COMMIT.test(command) ? 'commit' : null
}

function gateSegments(command: string): string[] {
  const joined = command.replace(/\\\r?\n/g, '').replace(/\\(.)/g, '$1')
  // Backticks stay: they mark an expansion the gate cannot read.
  return joined.replace(/["']/g, '').split(/[\n;&|]/)
}

function isGatedSegment(segment: string): boolean {
  if (!GH.test(segment)) return false
  if (MERGE_GATES.some(gate => gate.test(segment))) return true
  return OPAQUE.test(segment) && /\b(?:pr|api)\b/.test(segment)
}

export function isMergeInput(input: unknown): boolean {
  if (typeof input !== 'object' || input === null || !('command' in input)) return false
  const command = input.command
  return typeof command === 'string' && gateSegments(command).some(isGatedSegment)
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

  // A merge lands the PR and proposes 完了, so even in auto mode a person
  // approves it: `decider: 'person'` is settled by no classifier's allow, and
  // is a deny where nobody can be asked. A deny beneath still stands.
  on('tool.check', { tool: 'Bash' }, async ($, e, next) => {
    const verdict = await next(e)
    if (verdict.decision === 'deny' || !isMergeInput(e.input)) return verdict
    return { decision: 'ask', decider: 'person', reason: MERGE_REASON }
  }).catch(($, e, next) => (isMergeInput(e.input) ? { decision: 'deny', reason: MERGE_REASON } : next(e)))
}
