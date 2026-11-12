<script setup lang="ts">
import { computed, getCurrentInstance, nextTick, reactive, ref } from 'vue'
import { onBackPress, onLoad, onUnload } from '@dcloudio/uni-app'
import NoteIcon from '@/components/common/NoteIcon.vue'
import NoteNavBar from '@/components/common/NoteNavBar.vue'
import NoteEmojiPanel from '@/components/common/NoteEmojiPanel.vue'
import NoteSheet from '@/components/common/NoteSheet.vue'
import NoteActionSheet from '@/components/common/NoteActionSheet.vue'
import { getUserFacingErrorMessage } from '@/api/supabase'
import {
  MAX_NOTE_IMAGES,
  MAX_NOTE_IMAGE_BYTES,
  chooseNoteImages,
  removeNoteImages,
  uploadNoteImage,
  type ImageSource
} from '@/api/noteImages'
import type { Note, NoteMood } from '@/api/types'
import { usePageTheme } from '@/composables/usePageTheme'
import { useAuthStore } from '@/stores/auth'
import { useNotesStore } from '@/stores/notes'
import { useStorageModeStore } from '@/stores/storageMode'
import { isLocalStorageMode } from '@/utils/storageMode'
import { formatDateTime } from '@/utils/format'
import { haptic } from '@/utils/haptic'
import { editorInitialHtml, htmlToPlainText } from '@/utils/richText'

const MAX_LENGTH = 5000
const MAX_TAGS = 8
const MAX_TAG_LENGTH = 20
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
const storage = useStorageModeStore()

const noteId = ref('')
const original = ref<Note | null>(null)
const mood = ref<NoteMood>('calm')
const tags = ref<string[]>([])
const tagInput = ref('')
const tagOpen = ref(false)
const aiOpen = ref(false)
const imageSourceOpen = ref(false)
const confirmOpen = ref(false)
const confirmAction = ref<'discard' | 'delete'>('discard')
const listening = ref(false)
const voiceMessage = ref('')
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
let allowExit = false
let disposed = false

// #ifdef H5
interface SpeechResultEvent {
  resultIndex: number
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>
}
interface SpeechRecognitionInstance {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: ((event: SpeechResultEvent) => void) | null
  onerror: ((event: { error: string }) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
  abort(): void
}
let recognition: SpeechRecognitionInstance | null = null
// #endif

const isEdit = computed(() => Boolean(noteId.value))
const plainText = computed(() => htmlToPlainText(html.value))
const suggestedTags = computed(() => {
  const selected = new Set(tags.value.map((tag) => tag.toLocaleLowerCase()))
  const counts = new Map<string, { label: string; count: number }>()
  for (const note of [...store.notes, ...store.dayNotes]) {
    for (const tag of note.tags ?? []) {
      const key = tag.toLocaleLowerCase()
      if (selected.has(key)) continue
      const current = counts.get(key)
      counts.set(key, { label: current?.label ?? tag, count: (current?.count ?? 0) + 1 })
    }
  }
  const recent = [...counts.values()]
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'zh-CN'))
    .slice(0, 6)
    .map((item) => item.label)
  if (recent.length) return recent
  return ['生活', '家人', '旅行', '工作'].filter((tag) => !selected.has(tag.toLocaleLowerCase()))
})
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
    attachments.value.length !== (original.value?.images.length ?? 0) ||
    attachments.value.some((item) => item.status !== 'done' || !original.value?.images.includes(item.objectPath))
  if (original.value) {
    return (
      html.value !== editorInitialHtml(original.value.content) ||
      tags.value.join('\u0000') !== (original.value.tags ?? []).join('\u0000') ||
      imagesChanged
    )
  }
  return plainText.value.trim().length > 0 || tags.value.length > 0 || attachments.value.length > 0
})

const toolbarBottom = computed(() =>
  keyboardHeight.value > 0 ? `${keyboardHeight.value}px` : 'env(safe-area-inset-bottom)'
)
const emojiBottom = computed(() => `calc(${toolbarBottom.value} + 100rpx)`)
const voiceBottom = computed(() => `calc(${toolbarBottom.value} + 116rpx)`)

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

function beforeUnload(event: BeforeUnloadEvent) {
  if (!dirty.value || persisted || allowExit) return
  event.preventDefault()
  event.returnValue = ''
}
// #endif

onLoad(async (query) => {
  await storage.initialize()
  // #ifndef H5
  uni.onKeyboardHeightChange(onKeyboardHeightChange)
  // #endif
  // #ifdef H5
  window.visualViewport?.addEventListener('resize', syncKeyboardHeight)
  window.addEventListener('beforeunload', beforeUnload)
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
  tags.value = [...(found.tags ?? [])]
  createdAt.value = found.createdAt
  setEditorContent(found.content)
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
  window.removeEventListener('beforeunload', beforeUnload)
  recognition?.abort()
  // #endif
  if (!persisted) cleanupUnsavedImages()
})

onBackPress(() => {
  if (imageSourceOpen.value) { imageSourceOpen.value = false; return true }
  if (confirmOpen.value) { confirmOpen.value = false; return true }
  if (aiOpen.value) { aiOpen.value = false; return true }
  if (tagOpen.value) { tagOpen.value = false; return true }
  if (emojiOpen.value) { emojiOpen.value = false; return true }
  if (!dirty.value || persisted || allowExit || saving.value) return false
  cancel()
  return true
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
        context.setContents({ html: html.value })
      }
    })
    .exec()
}

function setEditorContent(content: string) {
  const initialHtml = editorInitialHtml(content)
  html.value = initialHtml
  textLength.value = htmlToPlainText(content).length

  // The route data and native editor can become ready in either order.
  // Keep the model as the source of truth and hydrate immediately when possible.
  editorCtx.value?.setContents({ html: initialHtml })
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

function hideKeyboard() {
  editorCtx.value?.blur()
}

function onEmojiPick(emoji: string) {
  editorCtx.value?.insertText({ text: emoji })
}

function removeTag(tag: string) {
  tags.value = tags.value.filter((item) => item !== tag)
  haptic('light')
}

function addTag() {
  const tag = tagInput.value.trim().replace(/\s+/g, ' ').slice(0, MAX_TAG_LENGTH)
  if (!tag) return
  if (tags.value.some((item) => item.toLocaleLowerCase() === tag.toLocaleLowerCase())) {
    uni.showToast({ title: '这个标签已经添加过了', icon: 'none' })
    return
  }
  if (tags.value.length >= MAX_TAGS) {
    uni.showToast({ title: `最多添加 ${MAX_TAGS} 个标签`, icon: 'none' })
    return
  }
  tags.value = [...tags.value, tag]
  tagInput.value = ''
  haptic('light')
}

function addSuggestedTag(tag: string) {
  tagInput.value = tag
  addTag()
}

function toggleVoice() {
  // #ifdef H5
  if (listening.value) {
    stopVoice()
    return
  }
  const speechWindow = window as typeof window & {
    SpeechRecognition?: new () => SpeechRecognitionInstance
    webkitSpeechRecognition?: new () => SpeechRecognitionInstance
  }
  const Constructor = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition
  if (!Constructor) {
    uni.showToast({ title: '当前浏览器不支持语音输入，请使用键盘输入', icon: 'none' })
    return
  }
  const session = new Constructor()
  recognition = session
  session.lang = 'zh-CN'
  session.continuous = true
  session.interimResults = true
  session.onresult = (event) => {
    if (recognition !== session || disposed) return
    let interim = ''
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i]
      if (!result) continue
      if (result.isFinal) editorCtx.value?.insertText({ text: result[0].transcript })
      else interim += result[0].transcript
    }
    voiceMessage.value = listening.value ? interim || '正在聆听' : ''
  }
  session.onerror = (event) => {
    if (recognition !== session || disposed || !listening.value) return
    voiceMessage.value = ''
    const message = event.error === 'not-allowed' ? '请允许浏览器使用麦克风' : '语音输入中断，请重试'
    uni.showToast({ title: message, icon: 'none' })
  }
  session.onend = () => {
    if (recognition !== session) return
    listening.value = false
    voiceMessage.value = ''
    recognition = null
  }
  try {
    session.start()
    listening.value = true
    voiceMessage.value = '正在聆听，点击麦克风结束'
  } catch {
    recognition = null
    uni.showToast({ title: '无法启动语音输入，请重试', icon: 'none' })
  }
  // #endif
  // #ifndef H5
  uni.showToast({ title: '当前平台暂不支持语音输入，请使用键盘输入', icon: 'none' })
  // #endif
}

function stopVoice() {
  // #ifdef H5
  const active = recognition
  listening.value = false
  voiceMessage.value = ''
  if (!active) return
  try {
    active.stop()
  } catch {
    active.abort()
    if (recognition === active) recognition = null
  }
  // #endif
  // #ifndef H5
  listening.value = false
  voiceMessage.value = ''
  // #endif
}

async function requireToken() {
  if (isLocalStorageMode()) return { token: '', userId: 'local-device' }
  const valid = await auth.ensureValidSession()
  if (!valid || !auth.token || !auth.user?.id) throw new Error('登录已过期，请重新登录')
  return { token: auth.token, userId: auth.user.id }
}

function addImages() {
  const remaining = MAX_NOTE_IMAGES - attachments.value.length
  if (remaining <= 0) {
    uni.showToast({ title: `最多 ${MAX_NOTE_IMAGES} 张图片`, icon: 'none' })
    return
  }
  hideKeyboard()
  emojiOpen.value = false
  imageSourceOpen.value = true
}

function addImagesFromRecognition() {
  aiOpen.value = false
  void nextTick(addImages)
}

async function selectImageSource(value: string) {
  if (value !== 'camera' && value !== 'album') return
  const source: ImageSource = value
  const remaining = MAX_NOTE_IMAGES - attachments.value.length
  if (remaining <= 0) return
  let chosen: Awaited<ReturnType<typeof chooseNoteImages>>
  try {
    chosen = await chooseNoteImages(remaining, source)
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
    if (disposed || !attachments.value.includes(attachment)) {
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
  confirmAction.value = 'discard'
  confirmOpen.value = true
}

async function save() {
  if (!canSave.value) return
  saving.value = true
  const draft = {
    content: html.value.trim() ? html.value : '<p><br></p>',
    mood: mood.value,
    images: doneImages.value.map((item) => item.objectPath),
    tags: tags.value
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
  confirmAction.value = 'delete'
  confirmOpen.value = true
}

async function confirmEditorAction() {
  if (confirmAction.value === 'discard') {
    allowExit = true
    uni.navigateBack()
    return
  }
  if (deleting.value) return
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
</script>

<template>
  <wd-config-provider :theme="themeName">
    <view class="page editor-page" :class="[themeClass, { 'note-dark': isDark }]">
      <NoteNavBar :title="formatDateTime(createdAt)">
        <template #left>
          <wd-button class="editor-nav-btn" variant="text" size="medium" aria-label="取消编辑" @click="cancel">
            <NoteIcon name="back" size="40rpx" />
          </wd-button>
        </template>
        <template #right>
          <wd-button
            class="editor-nav-btn editor-nav-btn--save"
            variant="text"
            size="medium"
            :loading="saving"
            :disabled="!canSave"
            @click="save"
          >
            完成
          </wd-button>
        </template>
      </NoteNavBar>

      <view class="editor-body">
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
          <view class="editor-input-actions">
            <button class="editor-tool" :class="{ 'editor-tool--active': listening }" :aria-pressed="listening" :aria-label="listening ? '结束语音输入' : '语音输入'" @mousedown.prevent @tap="toggleVoice">
              <NoteIcon name="mic" size="42rpx" />
            </button>
            <button class="editor-tool" aria-label="图片识别工具" @mousedown.prevent @tap="aiOpen = true">
              <NoteIcon name="sparkles" size="42rpx" />
            </button>
            <text class="editor-count" :class="{ 'editor-count--limit': overLimit }">{{ textLength }} / {{ MAX_LENGTH }}</text>
          </view>

          <view v-if="attachments.length" class="editor-media">
            <view v-for="item in attachments" :key="item.key" class="editor-media__item">
              <button
                class="editor-media__preview"
                :aria-label="item.status === 'error' ? '重试上传' : '预览图片'"
                @tap="previewAttachment(item)"
              >
                <image class="editor-media__img" :src="attachmentUrl(item)" mode="aspectFit" alt="待保存的笔记图片" />
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

          <view v-if="tags.length" class="editor-tags" aria-label="已添加的标签">
            <view v-for="tag in tags" :key="tag" class="editor-tag">
              <view class="editor-tag__label">
                <NoteIcon name="tag" size="24rpx" />
                <text class="editor-tag__text">{{ tag }}</text>
              </view>
              <button class="editor-tag__remove" :aria-label="`移除标签 ${tag}`" @tap="removeTag(tag)">
                <NoteIcon name="close" size="22rpx" />
              </button>
            </view>
          </view>
        </view>

        <button v-if="isEdit" class="editor-delete" :disabled="deleting" @tap="remove">
          <NoteIcon name="trash" size="30rpx" />
          {{ deleting ? '删除中…' : '删除这条笔记' }}
        </button>
      </view>

      <view v-if="voiceMessage" class="editor-voice" :style="{ bottom: voiceBottom }" role="status" aria-live="polite">
        <text>{{ voiceMessage }}</text>
        <button v-if="listening" class="editor-voice__stop" aria-label="立即结束语音输入" @tap="stopVoice">结束</button>
      </view>

      <view v-if="emojiOpen" class="editor-emoji" :style="{ bottom: emojiBottom }">
        <NoteEmojiPanel @pick="onEmojiPick" @close="emojiOpen = false" />
      </view>

      <view class="editor-toolbar" :style="{ bottom: toolbarBottom }" role="toolbar" aria-label="笔记编辑工具">
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
            :class="{ 'editor-tool--active': tagOpen || tags.length > 0 }"
            aria-label="整理标签"
            :aria-pressed="tagOpen"
            @mousedown.prevent
            @tap="tagOpen = true"
          >
            <NoteIcon name="tag" size="40rpx" />
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

      <NoteSheet v-model:show="aiOpen" title="图片识别" label="图片识别面板">
        <view class="editor-sheet">
          <view class="editor-ai-intro">
            <view class="editor-ai-intro__icon" aria-hidden="true"><NoteIcon name="sparkles" size="42rpx" /></view>
            <view class="editor-ai-intro__copy">
              <text class="editor-ai-intro__title">从图片中提取内容</text>
              <text class="editor-sheet__description">识别服务尚未连接，可先将图片添加到笔记。</text>
            </view>
          </view>
          <view v-if="attachments.length" class="editor-sheet__images">
            <button
              v-for="(item, index) in attachments"
              :key="item.key"
              class="editor-sheet__image"
              :aria-label="`预览第 ${index + 1} 张图片`"
              @tap="previewAttachment(item)"
            >
              <image :src="attachmentUrl(item)" mode="aspectFit" :alt="`笔记图片 ${index + 1}`" />
            </button>
          </view>
        </view>
        <template #footer>
          <view class="editor-sheet__actions">
            <button
              v-if="attachments.length < MAX_NOTE_IMAGES"
              class="note-btn note-btn--secondary"
              @tap="addImagesFromRecognition"
            >
              <NoteIcon name="image" size="32rpx" />
              添加到笔记
            </button>
            <button class="note-btn note-btn--primary" @tap="aiOpen = false">完成</button>
          </view>
        </template>
      </NoteSheet>

      <NoteActionSheet
        v-model:show="imageSourceOpen"
        title="选择图片来源"
        :items="[
          { value: 'camera', label: '拍照', icon: 'camera' },
          { value: 'album', label: '从手机相册选择', icon: 'image' }
        ]"
        @select="selectImageSource"
      />
      <NoteActionSheet
        v-model:show="confirmOpen"
        :title="confirmAction === 'delete' ? '删除笔记' : '放弃编辑？'"
        :description="confirmAction === 'delete' ? '删除后无法恢复，确定删除这条笔记吗？' : '当前修改尚未保存。'"
        :cancel-text="confirmAction === 'delete' ? '取消' : '继续编辑'"
        :items="[{ value: 'confirm', label: confirmAction === 'delete' ? '删除这条笔记' : '放弃修改', icon: confirmAction === 'delete' ? 'trash' : 'close', danger: true }]"
        @select="confirmEditorAction"
      />

      <NoteSheet v-model:show="tagOpen" title="整理标签" label="为这条笔记添加或移除标签">
        <view class="editor-sheet">
          <text class="editor-sheet__description">为记录加上关键词，以后更容易找到。</text>
          <view class="editor-tag-entry">
            <wd-input
              v-model="tagInput"
              placeholder="例如：生活、旅行、家人"
              :maxlength="MAX_TAG_LENGTH"
              clearable
              confirm-type="done"
              aria-label="标签名称"
              autocomplete="off"
              @confirm="addTag"
            >
              <template #prefix><text class="editor-tag-entry__hash" aria-hidden="true">#</text></template>
            </wd-input>
            <wd-button type="primary" :disabled="!tagInput.trim()" @click="addTag">添加</wd-button>
          </view>

          <view v-if="suggestedTags.length" class="editor-suggestions">
            <text class="editor-suggestions__title">快速添加</text>
            <view class="editor-suggestions__list">
              <button
                v-for="tag in suggestedTags"
                :key="tag"
                class="editor-suggestion"
                :aria-label="`添加常用标签 ${tag}`"
                @tap="addSuggestedTag(tag)"
              >
                <NoteIcon name="add" size="24rpx" />
                {{ tag }}
              </button>
            </view>
          </view>

          <text v-if="tags.length" class="editor-suggestions__title editor-selected-title">已添加 · {{ tags.length }}/{{ MAX_TAGS }}</text>
          <view v-if="tags.length" class="editor-tags editor-tags--panel" aria-label="已添加的标签">
            <view v-for="tag in tags" :key="tag" class="editor-tag">
              <view class="editor-tag__label">
                <NoteIcon name="tag" size="24rpx" />
                <text class="editor-tag__text">{{ tag }}</text>
              </view>
              <button class="editor-tag__remove" :aria-label="`移除标签 ${tag}`" @tap="removeTag(tag)">
                <NoteIcon name="close" size="22rpx" />
              </button>
            </view>
          </view>
        </view>
        <template #footer>
          <button class="note-btn note-btn--primary editor-sheet__done" @tap="tagOpen = false">完成</button>
        </template>
      </NoteSheet>
    </view>
  </wd-config-provider>
</template>

<style scoped lang="scss">
.editor-page {
  padding-bottom: calc(160rpx + env(safe-area-inset-bottom));
  background: var(--note-surface);
}

:deep(.editor-page .note-navbar__title) {
  color: var(--note-accent);
  font-size: var(--note-font-title3);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

:deep(.editor-nav-btn) {
  height: 88rpx;
  min-height: 44px;
  margin: 0;
  padding: 0 20rpx;
  color: var(--note-accent);
  font-size: var(--note-font-body);
  font-weight: 500;
}

:deep(.editor-nav-btn--save) {
  font-weight: 700;
}

:deep(.editor-nav-btn .wd-button__content) {
  min-height: 44px;
}

.editor-body {
  padding: calc(112rpx + env(safe-area-inset-top)) 32rpx 0;
}

.editor-paper {
  margin-top: 0;
  padding: 24rpx 8rpx 20rpx;
  border-radius: 0;
  border: 0;
  background: transparent;
  box-shadow: none;
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

.editor-input-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 4rpx;
  border-bottom: 1rpx solid var(--note-separator);
}

.editor-input-actions .editor-tool {
  color: var(--note-accent);
}

.editor-count {
  margin-left: 12rpx;
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

.editor-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 12rpx;
  margin-top: 24rpx;
}

.editor-tags--panel {
  margin: 24rpx 0;
}

.editor-tag {
  display: inline-flex;
  align-items: center;
  gap: 8rpx;
  max-width: 100%;
  min-height: 44px;
  padding-left: 20rpx;
  border-radius: 999rpx;
  color: var(--note-accent);
  background: var(--note-accent-soft);
  font-size: var(--note-font-footnote);
  font-weight: 600;
}

.editor-tag__label {
  display: flex;
  align-items: center;
  gap: 8rpx;
  min-width: 0;
  line-height: 1;
}

.editor-tag__label :deep(.note-icon) {
  align-self: center;
  transform: translateY(-1rpx);
}

.editor-tag__text {
  display: block;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  line-height: 1.2;
}

.editor-tag__remove {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  margin: 0;
  padding: 0;
  border: 0;
  border-radius: 50%;
  color: var(--note-accent);
  background: transparent;
}

.editor-tag__remove::after {
  border: 0;
}

.editor-tag__remove:active {
  background: rgba(var(--note-accent-rgb), 0.12);
}

.editor-tag-entry {
  display: flex;
  align-items: center;
  gap: 16rpx;
  margin-top: 22rpx;
}

.editor-tag-entry :deep(.wd-input) {
  flex: 1;
  min-width: 0;
  min-height: 48px;
  padding: 0 20rpx;
  border-radius: var(--note-radius-md);
  background: var(--note-fill-2);
}

.editor-tag-entry :deep(.wd-button) {
  min-height: 48px;
  padding: 0 28rpx;
  border-radius: var(--note-radius-md);
}

.editor-tag-entry__hash {
  margin-right: 12rpx;
  color: var(--note-accent);
  font-size: var(--note-font-title3);
  font-weight: 700;
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
  background: var(--note-fill-2);
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

.editor-delete {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12rpx;
  width: 100%;
  min-height: var(--note-control-height);
  margin-top: 32rpx;
  padding: 0 24rpx;
  border: 0;
  border-radius: var(--note-radius-md);
  color: var(--note-danger);
  background: transparent;
  font-size: var(--note-font-subhead);
  font-weight: 600;
  transition:
    background-color var(--note-duration-fast) var(--note-ease),
    opacity var(--note-duration-fast) var(--note-ease);
}

.editor-delete::after {
  border: 0;
}

.editor-delete:active {
  background: var(--note-danger-soft);
}

.editor-delete:disabled {
  opacity: 0.45;
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
  overflow-x: auto;
  background: var(--note-material-thick);
  backdrop-filter: blur(20px) saturate(180%);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
  border-top: 1rpx solid var(--note-separator);
}

.editor-toolbar__group {
  display: flex;
  flex: none;
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
  flex: none;
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

.editor-tool::after,
.editor-media__add::after {
  border: 0;
}

.editor-tool--active {
  color: var(--note-accent);
  background: var(--note-accent-soft);
}

.editor-voice {
  position: fixed;
  left: 24rpx;
  right: 24rpx;
  z-index: 37;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16rpx;
  padding: 14rpx 16rpx 14rpx 24rpx;
  border: 1rpx solid var(--note-separator);
  border-radius: 999rpx;
  color: var(--note-text);
  background: var(--note-material-thick);
  box-shadow: var(--note-shadow-md);
  font-size: var(--note-font-footnote);
}

.editor-voice__stop {
  flex: none;
  min-width: 88rpx;
  height: 64rpx;
  margin: 0;
  padding: 0 20rpx;
  border: 0;
  border-radius: 999rpx;
  color: var(--note-accent-contrast);
  background: var(--note-accent);
  font-size: var(--note-font-caption);
  font-weight: 700;
}

.editor-voice__stop::after { border: 0; }

.editor-sheet {
  padding: 8rpx 32rpx 24rpx;
}

.editor-sheet__description {
  display: block;
  color: var(--note-text-2);
  font-size: var(--note-font-footnote);
  line-height: 1.55;
}

.editor-ai-intro {
  display: flex;
  align-items: flex-start;
  gap: 20rpx;
  padding: 20rpx;
  border-radius: var(--note-radius-lg);
  background: var(--note-fill-2);
}

.editor-ai-intro__icon {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 80rpx;
  height: 80rpx;
  border-radius: var(--note-radius-md);
  color: var(--note-accent);
  background: var(--note-accent-soft);
}

.editor-ai-intro__copy { min-width: 0; }
.editor-ai-intro__title {
  display: block;
  margin-bottom: 8rpx;
  color: var(--note-text);
  font-size: var(--note-font-subhead);
  font-weight: 700;
}

.editor-sheet__images {
  display: flex;
  gap: 16rpx;
  margin-top: 24rpx;
  overflow-x: auto;
}

.editor-sheet__image {
  flex: none;
  width: 144rpx;
  height: 144rpx;
  min-width: 72px;
  min-height: 72px;
  margin: 0;
  padding: 0;
  overflow: hidden;
  border: 0;
  border-radius: var(--note-radius-md);
  background: var(--note-fill-2);
}

.editor-sheet__image image {
  width: 100%;
  height: 100%;
}

.editor-sheet__actions {
  display: flex;
  gap: 16rpx;
}

.editor-sheet__actions .note-btn,
.editor-sheet__done {
  flex: 1;
  width: 100%;
}

.editor-suggestions {
  margin-top: 28rpx;
}

.editor-suggestions__title {
  display: block;
  margin-bottom: 12rpx;
  color: var(--note-text-2);
  font-size: var(--note-font-caption);
  font-weight: 600;
}

.editor-selected-title { margin-top: 28rpx; }

.editor-suggestions__list {
  display: flex;
  flex-wrap: wrap;
  gap: 12rpx;
}

.editor-suggestion {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8rpx;
  min-height: 44px;
  margin: 0;
  padding: 0 24rpx;
  border: 1rpx solid var(--note-separator);
  border-radius: 999rpx;
  color: var(--note-text-2);
  background: var(--note-surface);
  font-size: var(--note-font-footnote);
}

.editor-suggestion::after {
  border: 0;
}

.editor-suggestion:active {
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
