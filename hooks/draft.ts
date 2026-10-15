import type { EngineInterface } from 'claude-code'

import { setDraft, setPending } from './state'

const TITLE_MAX = 80

async function git($: EngineInterface, args: readonly string[]): Promise<string> {
  try {
    const ran = await $.process.run(['git', ...args], { timeoutMs: 5000 })
    return ran.exitCode === 0 ? ran.stdout.trim().slice(0, 2000) : ''
  } catch {
    return ''
  }
}

// $.model.complete runs with no tools and no transcript, so the draft only
// fills the form; the person still edits it and presses confirm to write.
export async function draftFromWork($: EngineInterface): Promise<void> {
  const [branch, log, stat] = await Promise.all([
    git($, ['rev-parse', '--abbrev-ref', 'HEAD']),
    git($, ['log', '-5', '--oneline']),
    git($, ['diff', '--stat', 'HEAD']),
  ])
  if (branch === '' && log === '') {
    $.ui.toast('git の情報が取れないため、下書きを作れませんでした')
    return
  }
  const reply = await $.model.complete({
    model: 'haiku',
    maxTokens: 200,
    system:
      'You write one Japanese ticket title (under 60 characters) for the work described. Output the title only, no quotes, no key, no tag.',
    prompt: `<branch>${branch}</branch>\n<recent_commits>\n${log}\n</recent_commits>\n<uncommitted_changes>\n${stat}\n</uncommitted_changes>`,
  })
  if (!reply.isAnswered) {
    $.ui.toast(`下書きを作れませんでした (${reply.reason})`)
    return
  }
  const title = reply.text.split('\n')[0]?.trim().slice(0, TITLE_MAX) ?? ''
  await setDraft($, draft => (draft === null ? draft : { ...draft, title }))
  await setPending($, pending =>(pending?.kind === 'create' ? null : pending))
}
