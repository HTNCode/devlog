import type { EngineInterface } from 'claude-code'

import type { Pending } from '../types'
import { CONFIG, isConfigured, saveOption } from './config'
import { errorText, isRefusedBeforeRun, Notice } from './errors'
import { isSafeName } from './keys'
import { callTool, dataSourceIn } from './notion'
import { setLoad, setPending, setView } from './state'

type SetupPending = Extract<Pending, { kind: 'setup' }>

const TITLE = 'Devlog 課題'
// The owner label's other choice; the human one comes from settings.
const AI_OWNER = 'AI'
// emptyDraft prefers 仕事 and 中, so both are seeded. One 案件タグ is seeded
// too: addTagOption refuses to add a tag to a DB that has none.
const PRIORITIES = "'高':red, '中':yellow, '低':green"
const CATEGORIES = "'仕事':blue, '個人':purple, 'その他':gray"
const FIRST_TAG = '未分類'

// The new database's own URL, in the <database> tag of the create reply.
const DATABASE_URL = /<database url=\\?"(?:\{\{)?(https:\/\/[^"\\}]+)/
const NOTION_HOST = /(^|\.)notion\.(so|com|site)$/
const NOTION_ID = /([0-9a-f]{8})-?([0-9a-f]{4})-?([0-9a-f]{4})-?([0-9a-f]{4})-?([0-9a-f]{12})/gi

export const ALREADY_CONFIGURED =
  'DB は設定済みです。作り直すときは /config で devlog の dataSource を空にしてから実行してください'
const NO_PAGE_ID = 'ページの URL から ID を読み取れませんでした。Notion でページの URL をコピーし直すか、URL を省いてワークスペース直下に作ってください'
const UNSAFE = 'プロパティ名か選択肢の名前に引用符・バックスラッシュ・制御文字があるため、DB を作れません'

// A page URL also carries a view id in its query; the page's own id is the
// last one in the path.
export function parentPageId(raw: string): string | null {
  const path = raw.split(/[?#]/)[0] ?? ''
  const last = [...path.matchAll(NOTION_ID)].pop()
  return last === undefined ? null : last.slice(1, 6).join('-').toLowerCase()
}

// Built from the configured names so the new DB passes parseSchema as it
// is. The names are quoted into the DDL, so one that could close a quote
// stops it.
export function setupSchema(): string | null {
  const { prop, status, humanOwner } = CONFIG
  const owners = humanOwner === AI_OWNER ? [humanOwner] : [AI_OWNER, humanOwner]
  const names = [...Object.values(prop), status.todo, status.doing, status.done, ...owners]
  if (!names.every(isSafeName)) return null
  const ownerOptions = owners.map(name =>
    name === humanOwner ? `'${name}':blue:in_progress` : `'${name}':default:to_do`,
  )
  const columns = [
    `"${prop.title}" TITLE`,
    `"${prop.status}" STATUS('${status.todo}':gray:to_do, '${status.doing}':blue:in_progress, '${status.done}':green:complete)`,
    `"${prop.priority}" SELECT(${PRIORITIES})`,
    `"${prop.category}" SELECT(${CATEGORIES})`,
    `"${prop.tags}" MULTI_SELECT('${FIRST_TAG}':gray)`,
    `"${prop.owner}" STATUS(${ownerOptions.join(', ')})`,
    `"${prop.start}" DATE`,
    `"${prop.end}" DATE`,
  ]
  return `CREATE TABLE (${columns.join(', ')})`
}

// Only asks: the DB is created from the pane's confirm button. A page named
// but unreadable is refused, never taken as no page at all.
export async function requestSetup($: EngineInterface, args: string): Promise<{ text: string; isAsked: boolean }> {
  if (isConfigured()) return { text: ALREADY_CONFIGURED, isAsked: false }
  if (setupSchema() === null) return { text: UNSAFE, isAsked: false }
  const parentId = parentPageId(args)
  if (args.trim() !== '' && parentId === null) return { text: NO_PAGE_ID, isAsked: false }
  await setPending($, () => ({ kind: 'setup' as const, title: TITLE, parentId }))
  // The confirm row is the list's: a create form left open in $.state from
  // before would hide it.
  await setView($, () => 'list' as const)
  const where = parentId === null ? 'ワークスペース直下に非公開で' : '指定したページの下に'
  return { text: `${where}「${TITLE}」を作ります。ペインの確定ボタンで作成します`, isAsked: true }
}

// Notion made the database, but which data source it holds is unknown. It
// is never reported as a failure: a second setup would make a second DB.
class CreatedUnknownError extends Error {}

// The database's id from the reply's URL, taken only from a Notion host:
// the URL itself is never passed on or shown, the id alone is.
export function createdDatabaseId(reply: unknown): string | null {
  const raw = DATABASE_URL.exec(JSON.stringify(reply))?.[1]
  if (raw === undefined || !URL.canParse(raw)) return null
  const url = new URL(raw)
  return url.protocol === 'https:' && NOTION_HOST.test(url.hostname) ? parentPageId(url.pathname) : null
}

// The create reply names the data source; failing that, the database is
// read back by its id. A failed read-back ends in CreatedUnknownError, which
// tells the person the DB exists, so its own error adds nothing.
async function createdSource($: EngineInterface, reply: unknown): Promise<string> {
  const direct = dataSourceIn(reply)
  if (direct !== null) return direct
  const id = createdDatabaseId(reply)
  const fetched = id === null ? null : await callTool($, 'notion-fetch', { id }).catch((error: unknown) => error)
  const viaId = dataSourceIn(fetched)
  if (viaId !== null) return viaId
  throw new CreatedUnknownError(id ?? '')
}

async function createDatabase($: EngineInterface, pending: SetupPending): Promise<string> {
  if (isConfigured()) throw new Notice(ALREADY_CONFIGURED)
  const schema = setupSchema()
  if (schema === null) throw new Notice(UNSAFE)
  const parent = pending.parentId === null ? {} : { parent: { type: 'page_id', page_id: pending.parentId } }
  const reply = await callTool($, 'notion-create-database', { title: pending.title, schema, ...parent })
  return `collection://${await createdSource($, reply)}`
}

// Saving dataSource reloads this module, so the flags the confirm path uses
// are cleared before that save, and the save is the last step.
export async function confirmSetup($: EngineInterface, pending: SetupPending): Promise<void> {
  await setLoad($, l => ({ ...l, isWriting: true }))
  const created = await createDatabase($, pending).catch((error: unknown) =>
    error instanceof Error ? error : new Error(String(error)),
  )
  await setPending($, () => null)
  await setLoad($, l => ({ ...l, isWriting: false }))
  if (created instanceof CreatedUnknownError) {
    const where = created.message === '' ? '' : `（DB の ID: ${created.message}）`
    $.ui.toast(`「${pending.title}」は作成されましたが、データソースの ID を読み取れませんでした${where}。setup をやり直さず、Notion でその DB を開き、URL を /config の devlog の dataSource に入れてください`)
    return
  }
  if (created instanceof Error && isRefusedBeforeRun(created)) {
    $.ui.toast(`DB を作れませんでした: ${errorText(created)}`)
    return
  }
  // The request may have reached Notion before it failed: a second setup
  // could make a second DB, so the person checks first.
  if (created instanceof Error) {
    $.ui.toast(`作成結果を確認できませんでした（${errorText(created)}）。Notion に「${pending.title}」ができていないか確かめ、あればその DB の URL を /config の devlog の dataSource に入れてください。無ければもう一度 /devlog setup を実行してください`)
    return
  }
  $.ui.toast(`「${pending.title}」を作りました。dataSource に設定して読み込み直します`)
  // The DB and its id are known by now: whatever the save does, the id is
  // shown, so a second setup is never needed to recover it.
  // A save that throws ends like a refused one: the toast below says what
  // to do, with the id in it.
  const isSaved = await saveOption($, 'dataSource', created).catch(() => false)
  if (!isSaved) $.ui.toast(`dataSource を保存できませんでした。/config の devlog の dataSource に ${created} を入れてください`)
}
