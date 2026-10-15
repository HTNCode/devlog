import type { EngineInterface } from 'claude-code'

import type { Attachment, Issue, Pending } from '../types'
import {
  attachmentMarkdown,
  baseName,
  findHttpsUrl,
  isSafeUploadPath,
  MAX_UPLOAD_BYTES,
  parseAttachments,
  sanitizeFileName,
  withSuffix,
} from './attach-files'
import { callJson, readPage } from './notion'
import { parseJson } from './parse'
import { getAttachments, setAttachments, setPending } from './state'

const UPLOAD_HOST = 'https://api.notion.com/'
const HEADER_NAME = /^[A-Za-z0-9-]+$/
const FORM_FIELD = /^[A-Za-z0-9_-]+$/
const MAX_DOWNLOAD_BYTES = '52428800'
const MAX_SUFFIX = 50

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function issueLabel(issue: Issue): string {
  return issue.key ?? issue.title.slice(0, 20)
}

async function loadAttachments($: EngineInterface, pageId: string): Promise<void> {
  try {
    const page = await readPage($, pageId)
    const items = parseAttachments(page.content)
    await setAttachments($, a => (a?.pageId === pageId ? { ...a, items, isLoading: false, error: null } : a))
  } catch (error) {
    await setAttachments($, a => (a?.pageId === pageId ? { ...a, isLoading: false, error: message(error) } : a))
  }
}

export async function openAttachments($: EngineInterface, issue: Issue): Promise<void> {
  const current = await getAttachments($)
  if (current?.pageId === issue.pageId) {
    await setAttachments($, () => null)
    return
  }
  const pageId = issue.pageId
  await setAttachments($, () => ({ pageId, items: [], isLoading: true, error: null, path: '', preview: null }))
  await loadAttachments($, pageId)
}

export async function setAttachPath($: EngineInterface, path: string): Promise<void> {
  await setAttachments($, a => (a === null ? a : { ...a, path }))
}

export async function closePreview($: EngineInterface): Promise<void> {
  await setAttachments($, a => (a === null ? a : { ...a, preview: null }))
}

// Reads the path from state rather than a value captured at draw time, so
// the latest typing is what gets checked.
export async function requestUpload($: EngineInterface, issue: Issue): Promise<void> {
  const path = ((await getAttachments($))?.path ?? '').trim()
  if (!isSafeUploadPath(path)) {
    $.ui.toast('このパスは使えません（空、または ; , " などの文字を含む）')
    return
  }
  const stat = await $.fs.stat(path, { resolve: true }).catch(() => undefined)
  if (stat === undefined || stat.kind !== 'file' || stat.realPath === undefined) {
    $.ui.toast(`ファイルが見つかりません: ${path}`)
    return
  }
  if (stat.size > MAX_UPLOAD_BYTES || !isSafeUploadPath(stat.realPath)) {
    $.ui.toast('20 MiB を超えるファイル、または使えない文字を含むパスはアップロードできません')
    return
  }
  const pending: Pending = {
    kind: 'upload',
    pageId: issue.pageId,
    label: issueLabel(issue),
    path: stat.realPath,
    name: sanitizeFileName(baseName(stat.realPath)),
    size: stat.size,
  }
  await setPending($, () => pending)
}

function uploadArgs(reply: unknown, path: string): string[] {
  const url = findField(reply, 'upload_url')
  const field = findField(reply, 'upload_form_field') ?? 'file'
  const headers = typeof reply === 'object' && reply !== null ? Reflect.get(reply, 'upload_headers') : undefined
  if (url === null || !url.startsWith(UPLOAD_HOST) || !FORM_FIELD.test(field)) {
    throw new Error('アップロード先の応答を読めませんでした')
  }
  const headerArgs = Object.entries(typeof headers === 'object' && headers !== null ? headers : {}).flatMap(
    ([name, value]) => {
      if (typeof value !== 'string' || !HEADER_NAME.test(name) || /[\r\n]/.test(value)) {
        throw new Error('アップロード用のヘッダが不正です')
      }
      return ['-H', `${name}: ${value}`]
    },
  )
  return ['curl', '-sS', '--fail-with-body', '-X', 'POST', ...headerArgs, '-F', `${field}=@${path}`, url]
}

function findField(reply: unknown, name: string): string | null {
  if (typeof reply !== 'object' || reply === null) return null
  const value = Reflect.get(reply, name)
  return typeof value === 'string' ? value : null
}

export async function confirmUpload($: EngineInterface, pending: Extract<Pending, { kind: 'upload' }>): Promise<string> {
  if (!isSafeUploadPath(pending.path)) return 'このパスは使えないため、アップロードを中止しました'
  const created = await callJson($, 'notion-create-file-upload', { filename: sanitizeFileName(pending.name) })
  const ran = await $.process.run(uploadArgs(created, pending.path), { timeoutMs: 120000 })
  if (ran.exitCode !== 0) throw new Error(`アップロードに失敗しました: ${(ran.stderr || ran.stdout).slice(0, 200)}`)
  const markdown = attachmentMarkdown(parseJson(ran.stdout))
  if (markdown === null) throw new Error('アップロード結果を読めませんでした')
  await callJson($, 'notion-update-page', {
    page_id: pending.pageId,
    command: 'insert_content',
    content: markdown,
    position: { type: 'end' },
    allow_async: false,
  })
  if ((await getAttachments($))?.pageId === pending.pageId) await loadAttachments($, pending.pageId)
  return `${pending.name} を ${pending.label} に添付しました`
}

async function freeDestination($: EngineInterface, dir: string, name: string): Promise<string> {
  for (let n = 0; n <= MAX_SUFFIX; n += 1) {
    const candidate = `${dir}/${n === 0 ? name : withSuffix(name, n)}`
    if (!(await $.fs.exists(candidate))) return candidate
  }
  throw new Error('同名のファイルが多すぎるため保存できません')
}

// Files land in a folder of their own and are never opened or read back
// into the conversation: their contents are someone else's data.
async function download($: EngineInterface, issue: Issue, item: Attachment): Promise<string> {
  const reply = await callJson($, 'notion-get-file-download-urls', { references: [item.ref] })
  const url = findHttpsUrl(reply)
  if (url === null) throw new Error('ダウンロード用の URL を取得できませんでした')
  const home = await $.env.get('HOME')
  if (home === undefined || home === '') throw new Error('HOME が分からないため保存できません')
  const dir = `${home}/Downloads/notion-backlog/${sanitizeFileName(issue.key ?? issue.pageId)}`
  await $.process.run(['mkdir', '-p', dir])
  const dest = await freeDestination($, dir, sanitizeFileName(item.name))
  const args = ['curl', '-sS', '--fail', '--proto', '=https', '--max-filesize', MAX_DOWNLOAD_BYTES, '-o', dest, url]
  const ran = await $.process.run(args, { timeoutMs: 120000 })
  if (ran.exitCode !== 0) throw new Error(`ダウンロードに失敗しました: ${ran.stderr.slice(0, 200)}`)
  return dest
}

export async function saveAttachment($: EngineInterface, issue: Issue, item: Attachment): Promise<void> {
  try {
    $.ui.toast(`保存しました: ${await download($, issue, item)}`)
  } catch (error) {
    $.ui.toast(message(error))
  }
}

async function asPng($: EngineInterface, file: string): Promise<string> {
  if (/\.png$/i.test(file)) return file
  const out = `${file}.png`
  const ran = await $.process.run(['sips', '-s', 'format', 'png', file, '--out', out], { timeoutMs: 30000 })
  if (ran.exitCode !== 0) throw new Error('プレビュー用に PNG へ変換できませんでした')
  return out
}

export async function previewAttachment($: EngineInterface, issue: Issue, item: Attachment): Promise<void> {
  try {
    const file = await asPng($, await download($, issue, item))
    await setAttachments($, a => (a?.pageId === issue.pageId ? { ...a, preview: { name: item.name, file } } : a))
  } catch (error) {
    $.ui.toast(message(error))
  }
}
