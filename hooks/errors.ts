// Error text reaches the screen and, through /devlog list, the model. Only
// text this mod wrote itself is shown as is: a Notice. Anything else comes
// from the engine, a connector or a process and may echo what it was sent
// or holds, so only a fixed reason picked from it is shown.
export class Notice extends Error {}

// The engine's own wording when the auto mode classifier stops a call: a
// rejection of the call itself, never a connector's text.
const CLASSIFIER = /refused: .*classifier/i
const TIMEOUT = /timed? ?out/i

// Notion's own error answer to a request, as opposed to failing to reach
// Notion at all, which callers let through as is.
export class NotionToolError extends Notice {}

// Whether a failed call surely never ran: the mod's own checks, or the auto
// mode classifier, which stops a call before it is sent. Notion's error
// answers are free text that cannot tell whether a write ran, so they count
// as may-have-run, as does anything else (a timeout).
export function isRefusedBeforeRun(error: unknown): boolean {
  if (error instanceof NotionToolError) return false
  return error instanceof Notice || (error instanceof Error && CLASSIFIER.test(error.message))
}

export function errorText(error: unknown): string {
  if (error instanceof Notice) return error.message
  const text = error instanceof Error ? error.message : String(error)
  if (CLASSIFIER.test(text)) {
    return 'auto モードの安全チェックに止められました。settings.json の permissions.allow に、devlog が使う Notion ツールの許可ルールを入れてください'
  }
  if (TIMEOUT.test(text)) return '応答がタイムアウトしました。少し待ってから試してください'
  return '予期しないエラーが発生しました'
}

// Whole words only, so an id in the text (…-4000-…) names no status.
const REASONS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\b(timed? ?out|internal|unavailable|5\d\d)\b/, 'Notion 側で処理を終えられませんでした'],
  [/\b(not ?found|could not find|404)\b/, '対象が見つからないか、コネクタに共有されていません'],
  [/\b(unauthori[sz]ed|forbidden|permission|401|403)\b/, '権限がありません'],
  [/\b(rate ?limit(ed)?|too many|429)\b/, 'リクエストが多すぎます。少し待ってから試してください'],
  [/\b(validation|invalid|400)\b/, '内容が受け付けられませんでした'],
]

// Notion's error body is the connector's text: a reason picked from it is
// shown, the body itself never. The reason is only a hint for the person;
// nothing is decided from it.
export function notionError(tool: string, body: string): NotionToolError {
  const text = body.toLowerCase()
  const reason = REASONS.find(([pattern]) => pattern.test(text))?.[1] ?? '理由は不明です'
  return new NotionToolError(`${tool}: Notion がエラーを返しました（${reason}）`)
}
