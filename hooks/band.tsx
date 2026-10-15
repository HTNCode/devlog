import type { On } from 'claude-code'

import type { Issue } from '../types'
import { isConfigured, NOT_CONFIGURED } from './config'
import { matchIssues, shortDate, STATUS } from './keys'
import { confirmRow } from './pane-list'
import { getBranch, getIssues, getPending, getSchema, setPending } from './state'
import { startWork } from './work'

function summary(key: string, matches: readonly Issue[]): string {
  if (matches.length === 0) return `${key}: Notion に該当する未完了の課題がありません`
  if (matches.length > 1) return `${key}: ${matches.length} 件が該当します（キーが重複しています）`
  const issue = matches[0]
  return issue === undefined ? key : `${issue.title} [${issue.status}] 期限 ${shortDate(issue.end)}`
}

// The band names the issue the current branch points at. Status buttons
// show only when exactly one issue matches, so a duplicated key never
// changes the wrong ticket. A status change waiting for confirm (from a
// button, 着手 or a detected commit) is shown here first, since the band is
// on screen even where the pane is not, as inside a multiplexer.
export function registerBand(on: On): void {
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const { Box, Text, Button, Link } = $.ui.resolve(e)
    // A fresh install has no DB yet: say so instead of "no matching issue".
    if (!isConfigured()) return <Text dimColor>Devlog: {NOT_CONFIGURED}</Text>
    const pending = await getPending($)
    if (pending?.kind === 'status') return confirmRow($, { Box, Text, Button }, pending)
    const branch = await getBranch($)
    if (branch === null || branch.key === null) return next(e)
    const key = branch.key
    const matches = matchIssues(await getIssues($), key)
    const isWritable = (await getSchema($))?.isWritable === true
    const issue = matches.length === 1 ? matches[0] : undefined
    const ask = (target: Issue, to: string) =>
      setPending($, () => ({ kind: 'status' as const, pageId: target.pageId, label: key, from: target.status, to }))
    return (
      <Box gap={1} flexWrap="wrap">
        <Text dimColor wrap="truncate-end">
          {summary(key, matches)}
        </Text>
        {issue !== undefined && <Link href={issue.url} label="開く" />}
        {issue !== undefined && (
          <Button key="band-work" dimColor hotkey="w" onPress={() => void startWork($, issue)}>
            着手
          </Button>
        )}
        {issue !== undefined && isWritable && issue.status !== STATUS.doing && (
          <Button key="band-doing" dimColor hotkey="s" onPress={() => void ask(issue, STATUS.doing)}>
            {STATUS.doing}にする
          </Button>
        )}
        {issue !== undefined && isWritable && (
          <Button key="band-done" dimColor hotkey="d" onPress={() => void ask(issue, STATUS.done)}>
            {STATUS.done}にする
          </Button>
        )}
      </Box>
    )
  })
}
