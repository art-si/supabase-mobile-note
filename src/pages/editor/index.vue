<script setup lang="ts">
import { computed, getCurrentInstance, reactive, ref } from 'vue'
import { onLoad, onUnload } from '@dcloudio/uni-app'
import NoteIcon from '@/components/common/NoteIcon.vue'
import NoteNavBar from '@/components/common/NoteNavBar.vue'
import NoteEmojiPanel from '@/components/common/NoteEmojiPanel.vue'
import { getUserFacingErrorMessage } from '@/api/supabase'
import {
  MAX_NOTE_IMAGES,
  MAX_NOTE_IMAGE_BYTES,
  chooseNoteImages,
  removeNoteImages,
  uploadNoteImage
} from '@/api/noteImages'
import type { Note, NoteMood } from '@/api/types'
import { usePageTheme } from '@/composables/usePageTheme'
import { useAuthStore } from '@/stores/auth'
import { useNotesStore } from '@/stores/notes'
import { formatDateTime } from '@/utils/format'
import { MOODS } from '@/utils/moods'
import { editorInitialHtml, htmlToPlainText } from '@/utils/richText'

const MAX_LENGTH = 5000
const instance = getCurrentInstance()

interface EditorContext {
  format(name: string, value?: unknown): void
  insertText(options: { text: string }): void
  setContents(options: { html?: string }): void
  blur(): void
}

interface Attachment {
  key: string
  localPath: string
  objectPath: string
  status: 'uploading' | 'done' | 'error'
  progress: number
}

const { themeName, themeClass, isDark } = usePageTheme()
const auth = useAuthStore()
const store = useNotesStore()

const noteId = ref('')
const original = ref<Note | null>(null)
const mood = ref<NoteMood>('calm')
const saving = ref(false)
const deleting = ref(false)
const createdAt = ref(new Date().toISOString())

const html = ref('')
const textLength = ref(0)
const formats = ref<Record<string, unknown>>({})
const editorCtx = ref<EditorContext | null>(null)
const attachments = ref<Attachment[]>([])
const emojiOpen = ref(false)
const keyboardHeight = ref(0)

let keySeed = 0
let persisted = false
let disposed = false

const isEdit = computed(() => Boolean(noteId.value))
const plainText = computed(() => htmlToPlainText(html.value))
const doneImages = computed(() => attachments.value.filter((item) => item.status === 'done'))
const mediaBusy = computed(() => attachments.value.some((item) => item.status !== 'done'))
const overLimit = computed(() => textLength.value > MAX_LENGTH)
const canSave = computed(
  () =>
    !saving.value &&
    !mediaBusy.value &&
    !overLimit.value &&
    (plainText.value.trim().length > 0 || doneImages.value.length > 0)
)
const dirty = computed(() => {
  const imagesChanged =
    attachments.value.length > 0 &&
    (attachments.value.length !== (original.value?.images.length ?? 0) ||
      attachments.value.some((item) => item.status !== 'done' || !original.value?.images.includes(item.objectPath)))
  if (original.value) {
    return (
      html.value !== editorInitialHtml(original.value.content) ||
      mood.value !== original.value.mood ||
      imagesChanged
    )
  }
  return plainText.value.trim().length > 0 || mood.value !== 'calm' || attachments.value.length > 0
})

const toolbarBottom = computed(() =>
  keyboardHeight.value > 0 ? `${keyboardHeight.value}px` : 'env(safe-area-inset-bottom)'
)
const emojiBottom = computed(() => `calc(${toolbarBottom.value} + 100rpx)`)

function onKeyboardHeightChange(result: { height: number }) {
  keyboardHeight.value = result.height
}

// #ifdef H5
// H5 运行时没有 onKeyboardHeightChange，用 visualViewport推算键盘高度。
function syncKeyboardHeight() {
  const viewport = window.visualViewport
  if (!viewport) return
  keyboardHeight.value = Math.max(0, Math.round(window.innerHeight - viewport.height - viewport.offsetTop))
}
// #endif

onLoad((query) => {
  // #ifndef H5
  uni.onKeyboardHeightChange(onKeyboardHeightChange)
  // #endif
  // #ifdef H5
  window.visualViewport?.addEventListener('resize', syncKeyboardHeight)
  // #endif
  const id = query?.id
  if (!id) return
  const found = [...store.notes, ...store.dayNotes].find((note) => note.id === id)
  if (!found) {
    uni.showToast({ title: '笔记不存在', icon: 'none' })
    setTimeout(() => uni.navigateBack(), 600)
    return
  }
  noteId.value = found.id
  original.value = found
  mood.value = found.mood
  createdAt.value = found.createdAt
  html.value = editorInitialHtml(found.content)
  textLength.value = htmlToPlainText(found.content).length
  void store.resolveImages([found]).then(() => {
    if (disposed) return
    attachments.value = found.images.map((path) =>
      reactive<Attachment>({ key: path, localPath: '', objectPath: path, status: 'done', progress: 100 })
    )
  })
})

onUnload(() => {
  disposed = true
  // #ifndef H5
  uni.offKeyboardHeightChange(onKeyboardHeightChange)
  // #endif
  // #ifdef H5
  window.visualViewport?.removeEventListener('resize', syncKeyboardHeight)
  // #endif
  if (!persisted) cleanupUnsavedImages()
})

function onEditorReady() {
  uni
    .createSelectorQuery()
    .in(instance)
    .select('#note-editor')
    .context((result) => {
      const context = (result as unknown as { context: EditorContext }).context
      editorCtx.value = context
      if (original.value) {
        context.setContents({ html: editorInitialHtml(original.value.content) })
      }
    })
    .exec()
}

function onEditorInput(event: { detail: { html: string; text: string } }) {
  html.value = event.detail.html
  textLength.value = event.detail.text.length
}

function onStatusChange(event: { detail: Record<string, unknown> }) {
  formats.value = event.detail
}

function toggleBold() {
  editorCtx.value?.format('bold')
}

function toggleItalic() {
  editorCtx.value?.format('italic')
}

function toggleList() {
  editorCtx.value?.format('list', formats.value.list === 'bullet' ? false : 'bullet')
}

function toggleQuote() {
  editorCtx.value?.format('blockquote', !formats.value.blockquote)
}

function hideKeyboard() {
  editorCtx.value?.blur()
}

function onEmojiPick(emoji: string) {
  editorCtx.value?.insertText({ text: emoji })
}

async function requireToken() {
  const valid = await auth.ensureValidSession()
  if (!valid || !auth.token || !auth.user?.id) throw new Error('登录已过期，请重新登录')
  return { token: auth.token, userId: auth.user.id }
}

async function addImages() {
  const remaining = MAX_NOTE_IMAGES - attachments.value.length
  if (remaining <= 0) {
    uni.showToast({ title: `最多 ${MAX_NOTE_IMAGES} 张图片`, icon: 'none' })
    return
  }
  let chosen: Awaited<ReturnType<typeof chooseNoteImages>>
  try {
    chosen = await chooseNoteImages(remaining)
  } catch (error) {
    uni.showToast({ title: getUserFacingErrorMessage(error, '选择图片失败'), icon: 'none' })
    return
  }
  for (const file of chosen) {
    if (file.size > MAX_NOTE_IMAGE_BYTES) {
      uni.showToast({ title: '单张图片不能超过 10MB，已跳过', icon: 'none' })
      continue
    }
    const attachment = reactive<Attachment>({
      key: `img-${++keySeed}`,
      localPath: file.path,
      objectPath: '',
      status: 'uploading',
      progress: 0
    })
    attachments.value = [...attachments.value, attachment]
    void startUpload(attachment)
  }
}

async function startUpload(attachment: Attachment) {
  try {
    const { token, userId } = await requireToken()
    const objectPath = await uploadNoteImage(token, userId, attachment.localPath, (percent) => {
      attachment.progress = percent
    })
    if (disposed) {
      removeNoteImages(token, [objectPath]).catch(() => {})
      return
    }
    attachment.objectPath = objectPath
    attachment.status = 'done'
    attachment.progress = 100
  } catch {
    if (!disposed) attachment.status = 'error'
  }
}

function retryUpload(attachment: Attachment) {
  attachment.status = 'uploading'
  attachment.progress = 0
  void startUpload(attachment)
}

function cleanupUnsavedImages() {
  const paths = attachments.value
    .filter((item) => item.objectPath && !original.value?.images.includes(item.objectPath))
    .map((item) => item.objectPath)
  if (!paths.length) return
  void requireToken()
    .then(({ token }) => removeNoteImages(token, paths))
    .catch(() => {})
}

function removeAttachment(attachment: Attachment) {
  attachments.value = attachments.value.filter((item) => item.key !== attachment.key)
  if (attachment.objectPath && !original.value?.images.includes(attachment.objectPath)) {
    void requireToken()
      .then(({ token }) => removeNoteImages(token, [attachment.objectPath]))
      .catch(() => {})
  }
}

function attachmentUrl(attachment: Attachment) {
  return attachment.localPath || store.imageUrl(attachment.objectPath)
}

function previewAttachment(attachment: Attachment) {
  if (attachment.status === 'uploading') return
  if (attachment.status === 'error') {
    retryUpload(attachment)
    return
  }
  const urls = attachments.value.map(attachmentUrl).filter(Boolean)
  const current = attachmentUrl(attachment)
  if (!current || !urls.length) return
  uni.previewImage({ urls, current })
}

function cancel() {
  if (!dirty.value) {
    uni.navigateBack()
    return
  }
  uni.showModal({
    title: '放弃编辑？',
    content: '当前修改尚未保存',
    confirmText: '放弃',
    cancelText: '继续编辑',
    success: ({ confirm }) => {
      if (confirm) uni.navigateBack()
    }
  })
}

async function save() {
  if (!canSave.value) return
  saving.value = true
  const draft = {
    content: html.value.trim() ? html.value : '<p><br></p>',
    mood: mood.value,
    images: doneImages.value.map((item) => item.objectPath)
  }
  try {
    if (isEdit.value) {
      await store.update(noteId.value, draft)
    } else {
      await store.create(draft)
    }
    persisted = true
    uni.showToast({ title: '已保存', icon: 'success' })
    setTimeout(() => uni.navigateBack(), 400)
  } catch (error) {
    uni.showToast({ title: getUserFacingErrorMessage(error, '保存失败，请稍后重试'), icon: 'none' })
  } finally {
    saving.value = false
  }
}

function remove() {
  if (deleting.value) return
  uni.showModal({
    title: '删除笔记',
    content: '删除后无法恢复，确定删除这条笔记吗？',
    confirmText: '删除',
    confirmColor: '#ff3b30',
    cancelText: '取消',
    success: async ({ confirm }) => {
      if (!confirm) return
      deleting.value = true
      try {
        await store.remove(noteId.value)
        persisted = true
        uni.showToast({ title: '已删除', icon: 'success' })
        setTimeout(() => uni.navigateBack(), 400)
      } catch (error) {
        uni.showToast({ title: getUserFacingErrorMessage(error, '删除失败，请稍后重试'), icon: 'none' })
      } finally {
        deleting.value = false
      }
    }
  })
}
</script>

<template>
  <wd-config-provider :theme="themeName">
    <view class="page editor-page" :class="[themeClass, { 'note-dark': isDark }]">
      <NoteNavBar :title="isEdit ? '编辑笔记' : '写笔记'">
        <template #left>
          <button class="editor-nav-btn" @tap="cancel">取消</button>
        </template>
        <template #right>
          <button
            class="editor-nav-btn editor-nav-btn--save"
            :class="{ 'is-disabled': !canSave }"
            :disabled="!canSave"
            @tap="save"
          >
            {{ saving ? '保存中…' : '保存' }}
          </button>
        </template>
      </NoteNavBar>

      <view class="editor-body">
        <view class="editor-date">
          <NoteIcon name="calendar" size="30rpx" />
          <text>{{ formatDateTime(createdAt) }}</text>
        </view>

        <view class="editor-paper note-card">
          <editor
            id="note-editor"
            class="editor-richtext"
            placeholder="记录此刻的想法…"
            :read-only="saving"
            @ready="onEditorReady"
            @input="onEditorInput"
            @statuschange="onStatusChange"
          />
          <view class="editor-count" :class="{ 'editor-count--limit': overLimit }">
            {{ textLength }} / {{ MAX_LENGTH }}
          </view>

          <view class="editor-media">
            <view v-for="item in attachments" :key="item.key" class="editor-media__item">
              <button
                class="editor-media__preview"
                :aria-label="item.status === 'error' ? '重试上传' : '预览图片'"
                @tap="previewAttachment(item)"
              >
                <image class="editor-media__img" :src="attachmentUrl(item)" mode="aspectFill" />
                <view v-if="item.status === 'uploading'" class="editor-media__mask">
                  <text>{{ item.progress }}%</text>
                </view>
                <view v-else-if="item.status === 'error'" class="editor-media__mask editor-media__mask--error">
                  <NoteIcon name="refresh" size="36rpx" />
                  <text>重试</text>
                </view>
              </button>
              <button class="editor-media__remove" aria-label="移除图片" @tap="removeAttachment(item)">
                <NoteIcon name="close" size="24rpx" />
              </button>
            </view>
            <button
              v-if="attachments.length < MAX_NOTE_IMAGES"
              class="editor-media__add"
              aria-label="添加图片"
              @tap="addImages"
            >
              <NoteIcon name="image" size="44rpx" />
              <text>添加图片</text>
            </button>
          </view>
        </view>

        <view class="editor-moods">
          <text class="editor-moods__label">此刻心情</text>
          <view class="editor-moods__grid">
            <button
              v-for="item in MOODS"
              :key="item.id"
              class="editor-mood"
              :class="{ 'editor-mood--active': mood === item.id }"
              :style="mood === item.id ? { color: item.color, background: item.soft, borderColor: item.color } : {}"
              :aria-pressed="mood === item.id"
              @tap="mood = item.id"
            >
              <NoteIcon :name="item.icon" size="36rpx" />
              <text>{{ item.name }}</text>
            </button>
          </view>
        </view>

        <button v-if="isEdit" class="note-btn note-btn--danger editor-delete" :disabled="deleting" @tap="remove">
          <NoteIcon name="trash" size="32rpx" />
          {{ deleting ? '删除中…' : '删除这条笔记' }}
        </button>
      </view>

      <view v-if="emojiOpen" class="editor-emoji" :style="{ bottom: emojiBottom }">
        <NoteEmojiPanel @pick="onEmojiPick" @close="emojiOpen = false" />
      </view>

      <view class="editor-toolbar" :style="{ bottom: toolbarBottom }">
        <view class="editor-toolbar__group">
          <button class="editor-tool" aria-label="添加图片" @mousedown.prevent @tap="addImages">
            <NoteIcon name="image" size="44rpx" />
          </button>
          <button
            class="editor-tool"
            :class="{ 'editor-tool--active': emojiOpen }"
            :aria-pressed="emojiOpen"
            aria-label="表情"
            @mousedown.prevent
            @tap="emojiOpen = !emojiOpen"
          >
            <NoteIcon name="emoji" size="44rpx" />
          </button>
        </view>
        <view class="editor-toolbar__divider" aria-hidden="true" />
        <view class="editor-toolbar__group">
          <button
            class="editor-tool"
            :class="{ 'editor-tool--active': Boolean(formats.bold) }"
            :aria-pressed="Boolean(formats.bold)"
            aria-label="加粗"
            @mousedown.prevent
            @tap="toggleBold"
          >
            <NoteIcon name="bold" size="40rpx" />
          </button>
          <button
            class="editor-tool"
            :class="{ 'editor-tool--active': Boolean(formats.italic) }"
            :aria-pressed="Boolean(formats.italic)"
            aria-label="斜体"
            @mousedown.prevent
            @tap="toggleItalic"
          >
            <NoteIcon name="italic" size="40rpx" />
          </button>
          <button
            class="editor-tool"
            :class="{ 'editor-tool--active': formats.list === 'bullet' }"
            :aria-pressed="formats.list === 'bullet'"
            aria-label="列表"
            @mousedown.prevent
            @tap="toggleList"
          >
            <NoteIcon name="list" size="40rpx" />
          </button>
          <button
            class="editor-tool"
            :class="{ 'editor-tool--active': Boolean(formats.blockquote) }"
            :aria-pressed="Boolean(formats.blockquote)"
            aria-label="引用"
            @mousedown.prevent
            @tap="toggleQuote"
          >
            <NoteIcon name="quote" size="40rpx" />
          </button>
        </view>
        <view class="editor-toolbar__spacer" />
        <button
          v-if="keyboardHeight > 0"
          class="editor-tool"
          aria-label="收起键盘"
          @mousedown.prevent
          @tap="hideKeyboard"
        >
          <NoteIcon name="keyboard" size="44rpx" />
        </button>
      </view>
    </view>
  </wd-config-provider>
</template>

<style scoped lang="scss">
.editor-page {
  padding-bottom: calc(160rpx + env(safe-area-inset-bottom));
}

.editor-nav-btn {
  height: 88rpx;
  min-height: 44px;
  margin: 0;
  padding: 0 20rpx;
  border: 0;
  background: transparent;
  color: var(--note-accent);
  font-size: var(--note-font-body);
  font-weight: 500;
}

.editor-nav-btn--save {
  font-weight: 700;
}

.editor-nav-btn.is-disabled {
  opacity: 0.4;
}

.editor-body {
  padding: calc(112rpx + env(safe-area-inset-top)) 32rpx 0;
}

.editor-date {
  display: flex;
  align-items: center;
  gap: 10rpx;
  color: var(--note-text-2);
  font-size: var(--note-font-footnote);
  font-weight: 500;
}

.editor-paper {
  margin-top: 24rpx;
  padding: 28rpx 28rpx 20rpx;
}

.editor-richtext {
  width: 100%;
  min-height: 320rpx;
  color: var(--note-text);
  font-size: var(--note-font-body);
  line-height: 1.6;
}

.editor-richtext :deep(.ql-editor) {
  min-height: 320rpx;
  padding: 0;
  font-size: var(--note-font-body);
  line-height: 1.6;
  overflow-wrap: anywhere;
}

.editor-richtext :deep(.ql-editor.ql-blank::before) {
  left: 0;
  right: 0;
  color: var(--note-text-3);
  font-style: normal;
}

.editor-richtext :deep(.ql-editor blockquote) {
  margin: 8rpx 0;
  padding-left: 20rpx;
  border-left: 6rpx solid var(--note-separator-strong);
}

.editor-richtext :deep(.ql-editor ul),
.editor-richtext :deep(.ql-editor ol) {
  padding-left: 44rpx;
}

.editor-count {
  padding: 12rpx 0 8rpx;
  text-align: right;
  color: var(--note-text-3);
  font-size: var(--note-font-caption);
  font-variant-numeric: tabular-nums;
}

.editor-count--limit {
  color: var(--note-warning);
}

.editor-media {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16rpx;
  padding-top: 8rpx;
}

.editor-media__item {
  position: relative;
}

.editor-media__preview {
  position: relative;
  display: block;
  width: 100%;
  aspect-ratio: 1;
  margin: 0;
  padding: 0;
  border: 0;
  border-radius: var(--note-radius-md);
  overflow: hidden;
  background: var(--note-fill);
}

.editor-media__img {
  width: 100%;
  height: 100%;
}

.editor-media__mask {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6rpx;
  background: rgba(0, 0, 0, 0.45);
  color: #ffffff;
  font-size: var(--note-font-caption);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.editor-media__mask--error {
  background: var(--note-danger-soft);
  color: var(--note-danger);
}

.editor-media__remove {
  position: absolute;
  top: -14rpx;
  right: -14rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 56rpx;
  height: 56rpx;
  min-width: 44px;
  min-height: 44px;
  margin: 0;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: var(--note-material-thick);
  color: var(--note-text-2);
  box-shadow: var(--note-shadow-sm);
}

.editor-media__add {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8rpx;
  aspect-ratio: 1;
  margin: 0;
  padding: 0;
  border: 2rpx dashed var(--note-separator-strong);
  border-radius: var(--note-radius-md);
  background: transparent;
  color: var(--note-text-2);
  font-size: var(--note-font-caption);
  font-weight: 600;
}

.editor-media__add:active {
  background: var(--note-fill-2);
}

.editor-moods {
  margin-top: 40rpx;
}

.editor-moods__label {
  display: block;
  margin-bottom: 20rpx;
  color: var(--note-text-2);
  font-size: var(--note-font-footnote);
  font-weight: 600;
}

.editor-moods__grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16rpx;
}

.editor-mood {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10rpx;
  height: 88rpx;
  min-height: 44px;
  margin: 0;
  padding: 0;
  border: 2rpx solid transparent;
  border-radius: var(--note-radius-md);
  background: var(--note-fill);
  color: var(--note-text-2);
  font-size: var(--note-font-subhead);
  font-weight: 600;
  transition:
    background-color var(--note-duration-fast) var(--note-ease),
    color var(--note-duration-fast) var(--note-ease),
    border-color var(--note-duration-fast) var(--note-ease);
}

.editor-mood:active {
  transform: scale(0.97);
}

.editor-delete {
  width: 100%;
  margin-top: 56rpx;
}

.editor-toolbar {
  position: fixed;
  left: 0;
  right: 0;
  z-index: 35;
  display: flex;
  align-items: center;
  gap: 8rpx;
  height: 100rpx;
  padding: 0 16rpx;
  background: var(--note-material-thick);
  backdrop-filter: blur(20px) saturate(180%);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
  border-top: 1rpx solid var(--note-separator);
}

.editor-toolbar__group {
  display: flex;
  align-items: center;
  gap: 4rpx;
}

.editor-toolbar__divider {
  width: 1rpx;
  height: 44rpx;
  margin: 0 8rpx;
  background: var(--note-separator);
}

.editor-toolbar__spacer {
  flex: 1;
}

.editor-tool {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 80rpx;
  height: 80rpx;
  min-width: 44px;
  min-height: 44px;
  margin: 0;
  padding: 0;
  border: 0;
  border-radius: var(--note-radius-sm);
  background: transparent;
  color: var(--note-text-2);
  transition:
    background-color var(--note-duration-fast) var(--note-ease),
    color var(--note-duration-fast) var(--note-ease);
}

.editor-tool:active {
  background: var(--note-fill);
}

.editor-tool--active {
  color: var(--note-accent);
  background: var(--note-accent-soft);
}

.editor-emoji {
  position: fixed;
  left: 0;
  right: 0;
  z-index: 36;
  animation: editor-emoji-in var(--note-duration) var(--note-ease);
}

@keyframes editor-emoji-in {
  from {
    transform: translateY(24rpx);
    opacity: 0;
  }
  to {
    transform: translateY(0);
    opacity: 1;
  }
}
</style>