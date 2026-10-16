import type { EngineInterface } from 'claude-code'

import type { Draft, Pending, Schema } from '../types'
import { confirmUpload } from './attach'
import { CONFIG } from './config'
import { errorText } from './errors'
import { confirmDates } from './gantt-actions'
import { draftTag, keyFromBranch, missingFields } from './keys'
import { addTagOption, createIssue, fetchSchema, listOpenIssues, readStatus, updateStatus } from './notion'
import {
  getLoad,
  getPending,
  getSchema,
  getSelected,
  setBranch,
  setDraft,
  setIssues,
  setLoad,
  setOpenSummary,
  setPending,
  setSchema,
  setSelected,
  setView,
} from './state'

// Notion averages about three requests a second; a turn ending soon after the
// last load reuses it instead of asking again.
export const STALE_MS = 5 * 60 * 1000

function message(error: unknown): string {
  return errorText(error)
}

// Callers that arrive while a load runs share it instead of returning
// early with an empty list. Kept in the module, not in $.state: a hot reload
// mid-load must not leave a stale "loading" flag that blocks every refresh.
let inflight: Promise<void> | null = null

export function refresh($: EngineInterface, isSchemaReloaded = false): Promise<void> {
  if (inflight !== null) return inflight
  inflight = load($, isSchemaReloaded).finally(() => {
    inflight = null
  })
  return inflight
}

async function load($: EngineInterface, isSchemaReloaded: boolean): Promise<void> {
  await setLoad($, l => ({ ...l, isLoading: true, error: null }))
  try {
    const cached = await getSchema($)
    const schema = cached === null || isSchemaReloaded ? await fetchSchema($) : cached
    const issues = await listOpenIssues($)
    const fetchedAt = await $.clock.now()
    await setSchema($, () => schema)
    await setIssues($, () => issues)
    await setLoad($, l => ({ ...l, isLoading: false, fetchedAt }))
  } catch (error) {
    await setLoad($, l => ({ ...l, isLoading: false, error: message(error) }))
  }
}

export async function refreshIfStale($: EngineInterface): Promise<void> {
  const { fetchedAt } = await getLoad($)
  const now = await $.clock.now()
  if (inflight !== null || fetchedAt === null || now - fetchedAt > STALE_MS) await refresh($)
}

export async function refreshBranch($: EngineInterface): Promise<void> {
  try {
    const ran = await $.process.run(['git', 'rev-parse', '--abbrev-ref', 'HEAD'], { timeoutMs: 5000 })
    const name = ran.exitCode === 0 ? ran.stdout.trim() : ''
    const branch = name === '' || name === 'HEAD' ? null : { name, key: keyFromBranch(name) }
    await setBranch($, () => branch)
  } catch {
    await setBranch($, () => null)
  }
}

export function emptyDraft(schema: Schema, today: string, end: string): Draft {
  return {
    title: '',
    key: '',
    tag: schema.tags[0]?.name ?? '',
    newTag: '',
    category: schema.categories.includes('仕事') ? '仕事' : (schema.categories[0] ?? ''),
    priority: schema.priorities.includes('中') ? '中' : (schema.priorities[0] ?? ''),
    owner: schema.owners.includes(CONFIG.humanOwner) ? CONFIG.humanOwner : (schema.owners[0] ?? ''),
    start: today,
    end,
  }
}

async function confirmStatus($: EngineInterface, pending: Extract<Pending, { kind: 'status' }>): Promise<string> {
  const current = await readStatus($, pending.pageId)
  if (current !== pending.from) {
    return `${pending.label} は Notion 側で「${current ?? '不明'}」に変わっていたため、上書きしませんでした`
  }
  await updateStatus($, pending.pageId, pending.to)
  return `${pending.label} を「${pending.to}」にしました`
}

async function confirmCreate($: EngineInterface, draft: Draft): Promise<string> {
  const schema = await fetchSchema($)
  if (!schema.isWritable) return `書き込みを止めました: ${schema.problem ?? ''}`
  const missing = missingFields(draft, schema)
  if (missing.length > 0) return `未入力の項目があります: ${missing.join(', ')}`
  const tag = draftTag(draft)
  if (!schema.tags.some(option => option.name === tag)) await addTagOption($, schema.tags, tag)
  await createIssue($, draft)
  await setDraft($, () => null)
  await setView($, () => 'list' as const)
  return `「${draft.title.trim()}」を起票しました`
}

function confirmByKind($: EngineInterface, pending: Pending): Promise<string> {
  switch (pending.kind) {
    case 'status':
      return confirmStatus($, pending)
    case 'create':
      return confirmCreate($, pending.draft)
    case 'dates':
      return confirmDates($, pending)
    case 'upload':
      return confirmUpload($, pending)
  }
}

// The only path that writes to Notion: it runs from a confirm button the
// person pressed, never from a model turn.
export async function confirmPending($: EngineInterface): Promise<void> {
  const pending = await getPending($)
  const load = await getLoad($)
  if (pending === null || load.isWriting) return
  await setLoad($, l => ({ ...l, isWriting: true }))
  try {
    $.ui.toast(await confirmByKind($, pending))
  } catch (error) {
    $.ui.toast(`Notion への書き込みに失敗しました: ${message(error)}`)
  } finally {
    await setPending($, () => null)
    await setLoad($, l => ({ ...l, isWriting: false }))
  }
  await refresh($, pending.kind === 'create')
}

export async function cancelPending($: EngineInterface): Promise<void> {
  await setPending($, () => null)
}

// Selecting another issue drops what belonged to the previous one: a
// pending change and its open summary.
export async function selectIssue($: EngineInterface, pageId: string): Promise<void> {
  if ((await getSelected($)) === pageId) return
  await setSelected($, () => pageId)
  await setPending($, () => null)
  await setOpenSummary($, current => (current === pageId ? current : null))
}
