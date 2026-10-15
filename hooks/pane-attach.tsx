import type { Elements, EngineInterface } from 'claude-code'

import type { Attachments, Issue } from '../types'
import { closePreview, previewAttachment, requestUpload, saveAttachment, setAttachPath } from './attach'
import type { Ui } from './pane-list'

export type AttachUi = Ui & { Image?: Elements['terminal']['Image'] }

const PREVIEW_ROWS = 12
const PREVIEW_MAX_COLUMNS = 48

function previewBlock($: EngineInterface, ui: AttachUi, attachments: Attachments, bodyColumns: number) {
  const { Box, Text, Button, Image } = ui
  const preview = attachments.preview
  if (preview === null) return null
  // Inside a multiplexer such as tmux or herdr the kitty protocol does not
  // pass and Image shows only its alt, so the saved path is always written.
  const columns = Math.max(1, Math.min(PREVIEW_MAX_COLUMNS, bodyColumns - 2))
  return (
    <Box key="att-preview" flexDirection="column">
      {Image !== undefined ? (
        <Image
          key="att-preview-img"
          source={{ file: preview.file, format: 'png' }}
          columns={columns}
          rows={PREVIEW_ROWS}
          alt={`${preview.name}（画像を表示できない端末です）`}
        />
      ) : (
        <Text dimColor>この画面では画像を表示できません</Text>
      )}
      <Text dimColor wrap="wrap">
        保存先: {preview.file}
      </Text>
      <Button key="att-preview-close" dimColor hotkey="v" onPress={() => void closePreview($)}>
        プレビューを閉じる
      </Button>
    </Box>
  )
}

// Drawn under the selected issue's detail; every write goes through the
// shared confirm row, and downloads land in a folder the mod never opens.
// Every control is a Button or Input, so Tab and Enter reach all of them
// where there is no mouse; rows wrap so a narrow pane stays readable.
export function attachSection(
  $: EngineInterface,
  ui: AttachUi,
  issue: Issue,
  attachments: Attachments | null,
  bodyColumns = PREVIEW_MAX_COLUMNS + 2,
) {
  if (attachments === null) return null
  const { Box, Text, Button, Input } = ui
  return (
    <Box key={`attach-${issue.pageId}`} flexDirection="column">
      <Text dimColor>添付ファイル</Text>
      {attachments.isLoading && <Text dimColor>読み込み中...</Text>}
      {attachments.error !== null && <Text color="error">{attachments.error}</Text>}
      {!attachments.isLoading && attachments.items.length === 0 && <Text dimColor>添付はありません</Text>}
      {attachments.items.map((item, index) => (
        <Box key={`att-row-${index}`} gap={1} flexWrap="wrap">
          <Text wrap="truncate-end">
            {item.isImage ? '[画像] ' : ''}
            {item.name}
          </Text>
          <Button key={`att-save-${index}`} dimColor onPress={() => void saveAttachment($, issue, item)}>
            保存
          </Button>
          {item.isImage && (
            <Button key={`att-preview-${index}`} dimColor onPress={() => void previewAttachment($, issue, item)}>
              プレビュー
            </Button>
          )}
        </Box>
      ))}
      {previewBlock($, ui, attachments, bodyColumns)}
      <Input
        key="attach-path"
        label="アップロードするファイル"
        placeholder="/path/to/file.png"
        value={attachments.path}
        submitLabel="準備"
        onInput={value => void setAttachPath($, value)}
        onSubmit={value => void setAttachPath($, value).then(() => requestUpload($, issue))}
      />
      <Button key="attach-upload" dimColor hotkey="u" onPress={() => void requestUpload($, issue)}>
        アップロード
      </Button>
    </Box>
  )
}
