import type { CommandRunInput, EngineInterface, Register } from 'claude-code'

import { refresh, refreshBranch, refreshIfStale } from './actions'
import { registerBand } from './band'
import { openCreate, runCommand } from './command'
import { configure } from './config'
import { registerGit } from './git'
import { registerSummary } from './summary'
import { registerGantt } from './pane-gantt'
import { todayJst } from './keys'
import { createView } from './pane-create'
import { listView } from './pane-list'
import { errorText } from './errors'
import {
  getAttachments,
  getOpenSummary,
  getSummaries,
  getDraft,
  getIssues,
  getLoad,
  getPending,
  getSchema,
  getSelected,
  getTab,
  getView,
  PANE,
} from './state'

const ARGUMENT_HINT = '[gantt | new | setup | list | week | doing | human | refresh]'

async function answer($: EngineInterface, e: CommandRunInput) {
  try {
    return { text: await runCommand($, e.args, e.presentation) }
  } catch (error) {
    return { text: `notion-backlog: ${errorText(error)}` }
  }
}

// load() keeps every Notion failure in state for the pane and the band;
// what can still reject a background refresh is the state write itself,
// which has no place on screen, so it goes to the debug log.
function logBackground($: EngineInterface, error: unknown): void {
  $.ui.log(`notion-backlog: 背景の読み込みに失敗しました: ${errorText(error)}`, { to: 'debug' })
}

export const register: Register = (on, options) => {
  configure(options)
  // The validator recognises a command the module answers itself only when
  // register and matcher spell the name as a literal: keep each pair in sync.
  // immediate: the pane opens and closes while a turn is still running.
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'devlog',
      description: 'Notion の課題 DB を Backlog 風に表示・操作する（引数なしでペインを開閉）',
      argumentHint: ARGUMENT_HINT,
      immediate: true,
    })
    await $.command.register({
      name: 'dl',
      description: '/devlog の短縮形（引数なしでペインを開閉）',
      argumentHint: ARGUMENT_HINT,
      immediate: true,
    })
    void refreshBranch($)
    void refresh($).catch(error => logBackground($, error))
    return next(e)
  })

  on('command.run', { command: 'devlog' }, ($, e) => answer($, e))
  on('command.run', { command: 'dl' }, ($, e) => answer($, e))

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined) {
      void refreshBranch($)
      void refreshIfStale($).catch(error => logBackground($, error))
    }
    return result
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    const view = await getView($)
    // pane-gantt.tsx draws the gantt view with a hook of its own.
    if (view === 'gantt') return next(e)
    const schema = await getSchema($)
    const draft = await getDraft($)
    const pending = await getPending($)
    const load = await getLoad($)
    if (e.surface === 'mobile') {
      const { Text } = $.ui.resolve(e)
      return <Text>この画面ではペインを操作できません。/devlog list を使ってください</Text>
    }
    const ui = $.ui.resolve(e)
    if (view === 'create' && schema !== null && draft !== null) {
      return createView($, ui, { draft, schema, pending, load })
    }
    const data = {
      issues: await getIssues($),
      tab: await getTab($),
      selected: await getSelected($),
      schema,
      pending,
      load,
      today: todayJst(await $.clock.now()),
      attachments: await getAttachments($),
      summaries: await getSummaries($),
      openSummary: await getOpenSummary($),
    }
    return listView($, ui, data, () => void openCreate($))
  })

  registerBand(on)
  registerGantt(on)
  registerGit(on)
  registerSummary(on)
}
