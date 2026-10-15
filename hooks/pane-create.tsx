import type { EngineInterface } from 'claude-code'

import type { Draft, Load, Pending, Schema } from '../types'
import { draftFromWork } from './draft'
import { composeTitle, missingFields } from './keys'
import type { Ui } from './pane-list'
import { confirmRow, loadLine } from './pane-list'
import { setDraft, setPending, setView } from './state'

export type CreateData = {
  draft: Draft
  schema: Schema
  pending: Pending | null
  load: Load
}

type TextField = 'title' | 'key' | 'newTag' | 'start' | 'end'
type PickField = 'tag' | 'category' | 'priority' | 'owner'

// An edit after 内容を確認 drops the pending snapshot, so 確定 never writes
// a draft other than the one on screen.
function setField($: EngineInterface, field: TextField | PickField, value: string): void {
  void setDraft($, draft => (draft === null ? draft : { ...draft, [field]: value }))
  void setPending($, pending =>(pending?.kind === 'create' ? null : pending))
}

function options(values: readonly string[]) {
  return values.map(value => ({ value, label: value }))
}

export function createView($: EngineInterface, ui: Ui, data: CreateData) {
  const { Box, Text, Button, Input, Select } = ui
  const { draft, schema } = data
  const missing = missingFields(draft, schema)
  const status = loadLine(data.load, schema)
  const input = (field: TextField, label: string, placeholder: string) => (
    <Input
      key={`f-${field}`}
      label={label}
      placeholder={placeholder}
      value={draft[field]}
      submitLabel="反映"
      onInput={value => setField($, field, value)}
      onSubmit={value => setField($, field, value)}
    />
  )
  const pick = (field: PickField, label: string, values: readonly string[]) =>
    values.length === 0 ? (
      <Text key={`f-${field}`} color="error">
        {label}: 選択肢がありません
      </Text>
    ) : (
      <Select
        key={`f-${field}`}
        label={label}
        options={options(values)}
        value={draft[field]}
        onSelect={value => setField($, field, value)}
      />
    )
  const back = () => {
    void setPending($, () => null)
    void setView($, () => 'list' as const)
  }
  const review = () => void setPending($, () => ({ kind: 'create' as const, draft }))
  return (
    <Box flexDirection="column">
      <Box gap={1}>
        <Button key="back" dimColor onPress={back}>
          一覧へ
        </Button>
        <Button key="draft" dimColor onPress={() => void draftFromWork($)}>
          今の作業から下書き
        </Button>
      </Box>
      {status !== null && <Text dimColor>{status}</Text>}
      {input('title', '件名', '例: ログイン画面のバリデーション修正')}
      {input('key', '課題キー(任意)', '例: SEK-09')}
      {pick('tag', '案件タグ', schema.tags.map(option => option.name))}
      {input('newTag', '新しい案件タグ(任意)', '該当が無ければ入力。確定時に追加します')}
      {pick('category', 'カテゴリー', schema.categories)}
      {pick('priority', '優先順位', schema.priorities)}
      {pick('owner', '人間ラベル', schema.owners)}
      {input('start', '開始日', 'YYYY-MM-DD')}
      {input('end', '終了日', 'YYYY-MM-DD')}
      <Text dimColor wrap="truncate-end">
        件名プレビュー: {composeTitle(draft)}
      </Text>
      {missing.length > 0 ? (
        <Text color="warning">未入力: {missing.join(', ')}</Text>
      ) : data.pending?.kind === 'create' ? (
        confirmRow($, ui, data.pending)
      ) : (
        <Button key="review" variant="primary" onPress={review}>
          内容を確認
        </Button>
      )}
    </Box>
  )
}
