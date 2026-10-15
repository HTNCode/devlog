import type { Attachment } from '../types'

const FILE_REF = /notion-file-block:\/\/[^\s"'<>)\]]+/g
const NAME_PARAM = /[?&](?:amp;)?name=([^&"'<>\s]*)/
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|heic)$/i
// curl -F reads `;type=`, `,` (several files) and quotes inside the value
// after `@`, so a path holding them could rewrite the form part.
const UNSAFE_UPLOAD = /[;,"'`\\\p{Cc}]/u
const URL_SEARCH_DEPTH = 6

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024

function decodeName(raw: string): string {
  try {
    return decodeURIComponent(raw.replace(/\+/g, ' '))
  } catch {
    return raw
  }
}

export function isImageName(name: string): boolean {
  return IMAGE_EXT.test(name)
}

export function parseAttachments(content: string): Attachment[] {
  const seen = new Set<string>()
  const items: Attachment[] = []
  for (const ref of content.match(FILE_REF) ?? []) {
    if (seen.has(ref)) continue
    seen.add(ref)
    const raw = NAME_PARAM.exec(ref)?.[1]
    const name = raw === undefined || raw === '' ? 'file' : decodeName(raw)
    items.push({ name, ref, isImage: isImageName(name) })
  }
  return items
}

// The name is written into a folder we create, so only its last segment is
// kept and nothing in it can climb out or hide the file.
export function sanitizeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? ''
  const cleaned = base
    .replace(/\p{Cc}/gu, '')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 200)
  return cleaned === '' ? 'file' : cleaned
}

export function isSafeUploadPath(path: string): boolean {
  return path.trim() !== '' && !UNSAFE_UPLOAD.test(path)
}

export function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path
}

export function withSuffix(name: string, n: number): string {
  const dot = name.lastIndexOf('.')
  return dot <= 0 ? `${name}-${n}` : `${name.slice(0, dot)}-${n}${name.slice(dot)}`
}

// The download-URL reply's shape is not documented, so the first https URL
// anywhere in it is taken.
export function findHttpsUrl(value: unknown, depth = 0): string | null {
  if (typeof value === 'string') return value.startsWith('https://') ? value : null
  if (depth > URL_SEARCH_DEPTH || typeof value !== 'object' || value === null) return null
  for (const child of Object.values(value)) {
    const found = findHttpsUrl(child, depth + 1)
    if (found !== null) return found
  }
  return null
}

// Only the attachment block Notion itself suggested is appended to the page,
// never free text from the upload reply.
export function attachmentMarkdown(reply: unknown): string | null {
  if (typeof reply !== 'object' || reply === null) return null
  const suggested = Reflect.get(reply, 'suggested_markdown')
  if (typeof suggested === 'string' && /^<file src="file-upload:\/\/[0-9a-f-]+"><\/file>$/.test(suggested)) {
    return suggested
  }
  const source = Reflect.get(reply, 'markdown_source')
  return typeof source === 'string' && /^file-upload:\/\/[0-9a-f-]+$/.test(source) ? `<file src="${source}"></file>` : null
}
