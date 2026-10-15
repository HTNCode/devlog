import type { EngineInterface, On } from 'claude-code'

import type { Issue } from '../types'
import { refresh, refreshBranch } from './actions'
import { keyFromTitle, matchIssues, STATUS } from './keys'
import { getBranch, getIssues, getPending, setPending } from './state'

export type GitEvent = 'commit' | 'merge'

const COMMIT = /(?:^|[\s;&|(])git\s+(?:-C\s+\S+\s+)?commit\b/
const MERGE = /(?:^|[\s;&|(])gh\s+pr\s+merge\b/

export function gitEvent(command: string): GitEvent | null {
  if (MERGE.test(command)) return 'merge'
  return COMMIT.test(command) ? 'commit' : null
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
}
