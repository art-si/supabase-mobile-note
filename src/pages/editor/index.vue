<script setup lang="ts">
import { computed, getCurrentInstance, reactive, ref, watch } from 'vue'
import { onBackPress, onLoad, onUnload } from '@dcloudio/uni-app'
import NoteIcon from '@/components/common/NoteIcon.vue'
import NoteTag from '@/components/common/NoteTag.vue'
import NoteNavBar from '@/components/common/NoteNavBar.vue'
import NoteEmojiPanel from '@/components/common/NoteEmojiPanel.vue'
import NoteSheet from '@/components/common/NoteSheet.vue'
import NoteCalendar from '@/components/common/NoteCalendar.vue'
import NoteActionSheet from '@/components/common/NoteActionSheet.vue'
import NoteAssistant from '@/components/common/NoteAssistant.vue'
let nativeSpeech = false
// #ifdef H5
import { Capacitor } from '@capacitor/core'
import NoteVoiceInput from '@/components/common/NoteVoiceInput.vue'
nativeSpeech = Capacitor.getPlatform() === 'android'
// #endif
import { createNoteBatch, getCloudNote } from '@/api/notes'
import type { AssistantEntry } from '@/api/noteAssistant'
import { useNoteAssistant } from '@/composables/useNoteAssistant'
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
import { formatDateTime, formatTime, dayKey, parseDayKey } from '@/utils/format'
import { haptic } from '@/utils/haptic'
import { editorInitialHtml, htmlToPlainText, legacyToHtml } from '@/utils/richText'
import { getSystemInsets } from '@/utils/systemInsets'
import { readEditorDraft, saveEditorDraft, clearEditorDraft } from '@/api/editorDrafts'

const MAX_LENGTH = 5000
const MAX_TAGS = 8
const MAX_TAG_LENGTH = 20
const instance = getCurrentInstance()

interface EditorContext {
  format(name: string, value?: unknown): void
  insertText(options: { text: string }): void
  setContents(options: { html?: string }): void
  getContents(options: { success: (result: { html: string; text: string }) => void; fail?: () => void }): void
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
const { available: aiAvailable, cloudToken } = useNoteAssistant()
const aiOpen = ref(false)
const aiError = ref('')
const { top: statusInset, bottom: safeBottom } = getSystemInsets()

const noteId = ref('')
const original = ref<Note | null>(null)
const mood = ref<NoteMood>('calm')
const tags = ref<string[]>([])
const tagInput = ref('')
const tagOpen = ref(false)
const imageSourceOpen = ref(false)
const dateTimeOpen = ref(false)
const quickOpen = ref(false)
const phraseInput = ref('')
const quickPhrases = ref(readQuickPhrases())
const draftReady = ref(false)
const draftStatus = ref('')
const draftRestored = ref(false)
let draftTimer: ReturnType<typeof setTimeout> | null = null
const confirmOpen = ref(false)
const confirmAction = ref<'discard' | 'delete'>('discard')
const listening = ref(false)
const voiceMessage = ref('')
const saving = ref(false)
const deleting = ref(false)
const createdAt = ref(new Date().toISOString())
const dateTimeDraft = ref(createdAt.value)
const dateValue = computed(() => {
  const date = new Date(dateTimeDraft.value)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
})
const timeValue = computed(() => {
  const date = new Date(dateTimeDraft.value)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
})

const html = ref('')
const plainText = ref('')
const voiceAvailable = ref(false)
const textLength = computed(() => plainText.value.length)
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
    Boolean(editorCtx.value) &&
    !saving.value &&
    !deleting.value &&
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
      createdAt.value !== original.value.createdAt ||
      imagesChanged
    )
  }
  return plainText.value.trim().length > 0 || tags.value.length > 0 || attachments.value.length > 0
})

const toolbarBottom = computed(() =>
  `${keyboardOffset.value}px`
)
const keyboardOffset = ref(0)
let viewportBaseHeight = 0
const toolbarInset = computed(() => keyboardHeight.value > 0 ? '0px' : 'var(--note-inset-bottom)')
const emojiBottom = computed(() => `calc(${toolbarBottom.value} + 50px + ${toolbarInset.value})`)
const voiceBottom = computed(() => `calc(${toolbarBottom.value} + 58px + ${toolbarInset.value})`)

function onKeyboardHeightChange(result: { height: number }) {
  keyboardHeight.value = result.height
  keyboardOffset.value = result.height
}

function updateCreatedDate(value: string) {
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(dateTimeDraft.value)
  date.setFullYear(year!, month! - 1, day!)
  dateTimeDraft.value = new Date(Math.min(date.getTime(), Date.now())).toISOString()
}

function updateCreatedTime(value: string) {
  const [hour, minute] = value.split(':').map(Number)
  const date = new Date(dateTimeDraft.value)
  date.setHours(hour!, minute!, 0, 0)
  dateTimeDraft.value = new Date(Math.min(date.getTime(), Date.now())).toISOString()
}

// #ifdef H5
// H5 运行时没有 onKeyboardHeightChange，用 visualViewport推算键盘高度。
function syncKeyboardHeight() {
  const viewport = window.visualViewport
  if (!viewport) return
  viewportBaseHeight = Math.max(viewportBaseHeight, window.innerHeight)
  keyboardOffset.value = Math.max(0, Math.round(window.innerHeight - viewport.height - viewport.offsetTop))
  const resizedHeight = viewportBaseHeight - window.innerHeight
  keyboardHeight.value = Math.max(keyboardOffset.value, resizedHeight > 120 ? resizedHeight : 0)
}

function beforeUnload(event: BeforeUnloadEvent) {
  if (!dirty.value || persisted || allowExit) return
  event.preventDefault()
  event.returnValue = ''
}
// #endif

onLoad(async (query) => {
  const initialization = storage.initialize()
  if (storage.mode === 'cloud') await initialization
  // #ifndef H5
  uni.onKeyboardHeightChange(onKeyboardHeightChange)
  // #endif
  // #ifdef H5
  window.visualViewport?.addEventListener('resize', syncKeyboardHeight)
  window.addEventListener('resize', syncKeyboardHeight)
  syncKeyboardHeight()
  window.addEventListener('beforeunload', beforeUnload)
  // #endif
  const id = query?.id
  if (!id) {
    if (typeof query?.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(query.day)) {
      const date = parseDayKey(query.day)
      if (Number.isFinite(date.getTime()) && dayKey(date.toISOString()) === query.day) {
        const now = new Date()
        date.setHours(now.getHours(), now.getMinutes(), 0, 0)
        createdAt.value = date.toISOString()
      }
    }
    restoreTextDraft()
    return
  }
  let found = [...store.notes, ...store.dayNotes].find((note) => note.id === id)
  if (!found && storage.mode === 'cloud') {
    try {
      const token = await store.requireToken()
      if (!auth.user?.id) throw new Error('请重新登录云端')
      found = await getCloudNote(token, auth.user.id, id)
    } catch (error) {
      uni.showToast({ title: getUserFacingErrorMessage(error, '无法打开云端笔记'), icon: 'none' })
      setTimeout(() => uni.navigateBack(), 600)
      return
    }
  }
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
  attachments.value = found.images.map((path) =>
    reactive<Attachment>({ key: path, localPath: '', objectPath: path, status: 'done', progress: 100 })
  )
  setEditorContent(found.content)
  restoreTextDraft()
  void store.resolveImages([found])
})

onUnload(() => {
  if (draftTimer) clearTimeout(draftTimer)
  if (!persisted && !allowExit) persistTextDraft()
  disposed = true
  // #ifndef H5
  uni.offKeyboardHeightChange(onKeyboardHeightChange)
  // #endif
  // #ifdef H5
  window.visualViewport?.removeEventListener('resize', syncKeyboardHeight)
  window.removeEventListener('beforeunload', beforeUnload)
  window.removeEventListener('resize', syncKeyboardHeight)
  const root = document.querySelector('#note-editor .ql-editor')
  root?.removeEventListener('input', syncEditorFromDom)
  root?.removeEventListener('compositionend', syncEditorFromDom)
  recognition?.abort()
  // #endif
  if (!persisted) cleanupUnsavedImages()
})

onBackPress(() => {
  if (persisted || allowExit) return false
  if (saving.value || deleting.value) return true
  if (aiOpen.value) { aiOpen.value = false; return true }
  const panel = [confirmOpen, imageSourceOpen, dateTimeOpen, quickOpen, tagOpen, emojiOpen].find(item => item.value)
  if (panel) {
    panel.value = false
    return true
  }
  if (!dirty.value) return false
  cancel()
  return true
})

const draftKey = computed(() => `note-text-draft:${storage.mode}:${auth.user?.id || 'local'}:${noteId.value || 'new'}`)

function restoreTextDraft() {
  const draft = readEditorDraft(draftKey.value)
  if (draft && draft.originalUpdatedAt === (original.value?.updatedAt || '')) {
    setEditorContent(draft.html)
    tags.value = draft.tags
    createdAt.value = draft.createdAt
    draftRestored.value = true
    draftStatus.value = '文字草稿已保存在本机'
  }
  draftReady.value = true
}

function persistTextDraft() {
  if (!draftReady.value || persisted || allowExit) return false
  try {
    if (!dirty.value || (!plainText.value.trim() && !tags.value.length)) {
      clearEditorDraft(draftKey.value)
      draftStatus.value = ''
      return false
    }
    saveEditorDraft(draftKey.value, { html: html.value, tags: tags.value, createdAt: createdAt.value, originalUpdatedAt: original.value?.updatedAt || '' })
    draftStatus.value = '文字草稿已保存在本机'
    return true
  } catch (error) {
    console.warn('[editor] draft write failed', error)
    draftStatus.value = '草稿保存失败，请及时完成'
    return false
  }
}

function clearTextDraft() {
  if (draftTimer) clearTimeout(draftTimer)
  try { clearEditorDraft(draftKey.value) } catch (error) { console.warn('[editor] draft cleanup failed', error) }
}

watch([html, tags, createdAt], () => {
  if (!draftReady.value || persisted || allowExit) return
  if (draftTimer) clearTimeout(draftTimer)
  draftTimer = setTimeout(persistTextDraft, 500)
}, { deep: true })

function readQuickPhrases(): string[] {
  try {
    const value: unknown = uni.getStorageSync('note-quick-phrases')
    if (Array.isArray(value) && value.length <= 8 && value.every(item => typeof item === 'string' && item.length <= 30)) return value
  } catch (error) {
    console.warn('[editor] phrase read failed', error)
  }
  return ['喂奶：', '辅食：', '排便：', '睡眠：']
}

function persistQuickPhrases() {
  try { uni.setStorageSync('note-quick-phrases', quickPhrases.value) }
  catch (error) { console.warn('[editor] phrase write failed', error); uni.showToast({ title: '短语保存失败，请重试', icon: 'none' }) }
}

function insertPhrase(phrase: string) {
  editorCtx.value?.insertText({ text: phrase })
  quickOpen.value = false
  haptic('light')
}

function addPhrase() {
  const phrase = phraseInput.value.trim()
  if (!phrase || quickPhrases.value.length >= 8 || quickPhrases.value.includes(phrase)) return
  quickPhrases.value = [...quickPhrases.value, phrase]
  phraseInput.value = ''
  persistQuickPhrases()
}

function removePhrase(phrase: string) {
  quickPhrases.value = quickPhrases.value.filter(item => item !== phrase)
  persistQuickPhrases()
}

function onEditorReady() {
  // #ifdef H5
  voiceAvailable.value = 'SpeechRecognition' in window || 'webkitSpeechRecognition' in window
  // Android paste/composition can reach the DOM before Quill emits input.
  const root = document.querySelector('#note-editor .ql-editor')
  root?.addEventListener('input', syncEditorFromDom)
  root?.addEventListener('compositionend', syncEditorFromDom)
  // #endif
  uni
    .createSelectorQuery()
    .in(instance)
    .select('#note-editor')
    .context((result) => {
      const context = (result as unknown as { context: EditorContext }).context
      editorCtx.value = context
      if (html.value) {
        context.setContents({ html: html.value })
      }
    })
    .exec()
}

// #ifdef H5
function syncEditorFromDom() {
  requestAnimationFrame(() => {
    if (disposed) return
    const root = document.querySelector<HTMLElement>('#note-editor .ql-editor')
    if (root) onEditorInput({ detail: { html: root.innerHTML, text: root.innerText } })
  })
}
// #endif

function setEditorContent(content: string) {
  const initialHtml = editorInitialHtml(content)
  html.value = initialHtml
  plainText.value = htmlToPlainText(content)

  // The route data and native editor can become ready in either order.
  // Keep the model as the source of truth and hydrate immediately when possible.
  editorCtx.value?.setContents({ html: initialHtml })
}

function onEditorInput(event: { detail: { html: string; text: string } }) {
  plainText.value = event.detail.text.replace(/\n$/, '')
  html.value = event.detail.html || legacyToHtml(plainText.value)
}

function onStatusChange(event: { detail: Record<string, unknown> }) {
  formats.value = event.detail
}

function toggleBold() {
  editorCtx.value?.format('bold')
}

function openDateTime() {
  dateTimeDraft.value = new Date(Math.min(new Date(createdAt.value).getTime(), Date.now())).toISOString()
  hideKeyboard()
  emojiOpen.value = false
  dateTimeOpen.value = true
}

function confirmDateTime() {
  createdAt.value = new Date(Math.min(new Date(dateTimeDraft.value).getTime(), Date.now())).toISOString()
  haptic('light')
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

function startVoice() {
  // #ifdef H5
  if (listening.value) return
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
  if (isLocalStorageMode()) return {
  token: '', userId: 'local-device'
}
  const valid = await auth.ensureValidSession()
  if (!valid || !auth.token || !auth.user?.id) throw new Error('登录已过期，请重新登录')
  await auth.requireCloudAccess()
  return {
  token: auth.token, userId: auth.user.id
}
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
  if (saving.value || deleting.value) return
  if (!dirty.value) {
    navigateToPreviousPage()
    return
  }
  confirmAction.value = 'discard'
  confirmOpen.value = true
}

function navigateToPreviousPage() {
  if (getCurrentPages().length > 1) return uni.navigateBack()
  return uni.reLaunch({ url: '/pages/timeline/index' })
}

async function save() {
  if (new Date(createdAt.value).getTime() > Date.now()) {
    uni.showToast({ title: '记录时间不能晚于当前时间', icon: 'none' })
    return
  }
  if (saving.value) return
  if (editorCtx.value) {
    await new Promise<void>((resolve) => {
      editorCtx.value!.getContents({
        success: (detail) => { onEditorInput({ detail }); resolve() },
        fail: () => resolve()
      })
    })
  }
  if (!canSave.value) return
  saving.value = true
  const draft = {
    content: html.value.trim() ? html.value : '<p><br></p>',
    mood: mood.value,
    images: doneImages.value.map((item) => item.objectPath),
    tags: tags.value,
    createdAt: createdAt.value
  }
  try {
    if (isEdit.value) {
      await store.update(noteId.value, draft)
    } else {
      await store.create(draft)
    }
    persisted = true
    clearTextDraft()
    haptic('success')
    uni.showToast({ title: '已保存', icon: 'none', duration: 1000 })
    await navigateToPreviousPage()
  } catch (error) {
    uni.showToast({ title: getUserFacingErrorMessage(error, '保存失败，请稍后重试'), icon: 'none' })
  } finally {
    saving.value = false
  }
}

function openAi() {
  if (!aiAvailable.value || isEdit.value || attachments.value.length || saving.value) return
  hideKeyboard()
  emojiOpen.value = false
  aiError.value = ''
  aiOpen.value = true
}

async function saveAi(entries: AssistantEntry[]) {
  if (saving.value || !aiOpen.value || !entries.length) return
  saving.value = true
  aiError.value = ''
  try {
    const drafts = entries.map(entry => {
      const date = parseDayKey(entry.day)
      const [hour, minute] = (entry.time || formatTime(createdAt.value)).split(':').map(Number)
      date.setHours(hour ?? 0, minute ?? 0, 0, 0)
      return { id: entry.id, content: legacyToHtml(entry.text.trim()), mood: mood.value, images: [], tags: [...tags.value], createdAt: date.toISOString() }
    })
    await createNoteBatch(await cloudToken(), drafts)
    store.invalidateMonths()
    persisted = true
    aiOpen.value = false
    clearTextDraft()
    haptic('success')
    uni.showToast({ title: `已保存 ${drafts.length} 条笔记`, icon: 'none' })
    await navigateToPreviousPage()
  } catch (error) {
    aiError.value = getUserFacingErrorMessage(error, '保存失败，可以重试')
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
    clearTextDraft()
    navigateToPreviousPage()
    return
  }
  if (deleting.value) return
  deleting.value = true
  try {
    await store.remove(noteId.value)
    persisted = true
    clearTextDraft()
    haptic('success')
    uni.showToast({ title: '已删除', icon: 'none', duration: 1000 })
    await navigateToPreviousPage()
  } catch (error) {
    uni.showToast({ title: getUserFacingErrorMessage(error, '删除失败，请稍后重试'), icon: 'none' })
  } finally {
    deleting.value = false
  }
}

function keepDraftAndExit() {
  if (!persistTextDraft()) {
    uni.showToast({ title: '草稿未能保存，请继续编辑', icon: 'none' })
    return
  }
  confirmOpen.value = false
  allowExit = true
  void navigateToPreviousPage()
}
</script>

<template>
  <wd-config-provider :theme="themeName">
    <view class="page editor-page" :class="[themeClass, { 'note-dark': isDark }]" :style="{ '--note-status-inset': `${statusInset}px`, '--note-safe-bottom': `${safeBottom}px` }">
      <NoteNavBar>
        <template #title>
          <button class="editor-date-title" aria-label="修改笔记日期和时间" @tap="openDateTime">
            <text class="editor-date-title__label">{{ formatDateTime(createdAt) }}</text>
            <NoteIcon class="editor-date-title__icon" name="chevron-right" size="11" />
          </button>
        </template>
        <template #left>
          <wd-button class="editor-nav-btn" variant="text" size="medium" aria-label="取消编辑" :disabled="saving || deleting" @click="cancel">
            <NoteIcon name="back" size="40rpx" />
          </wd-button>
        </template>
        <template #right>
          <button
            class="editor-nav-btn editor-nav-btn--save"
            :disabled="!canSave"
            @tap="save"
          >
            {{ saving ? '保存中…' : '完成' }}
          </button>
        </template>
      </NoteNavBar>

      <view class="editor-body">
        <view v-if="draftRestored" class="editor-draft-restored" role="status">
          <text>已恢复上次未完成的文字</text><button aria-label="关闭草稿提示" @tap="draftRestored = false"><NoteIcon name="close" size="24rpx" /></button>
        </view>
        <view class="editor-paper">
          <editor
            id="note-editor"
            class="editor-richtext"
            placeholder="记录此刻的想法…"
            :read-only="saving || deleting"
            @ready="onEditorReady"
            @input="onEditorInput"
            @statuschange="onStatusChange"
          />
          <view v-if="!plainText.trim() && !isEdit" class="editor-quick-start" aria-label="快速开始记录">
            <button v-for="phrase in quickPhrases" :key="phrase" :disabled="!editorCtx" @mousedown.prevent @tap="insertPhrase(phrase)">{{ phrase }}</button>
          </view>
          <view class="editor-input-actions">
            <text v-if="draftStatus" class="editor-draft-status" role="status">{{ draftStatus }}</text>
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
            <NoteTag v-for="tag in tags" :key="tag" :label="tag" removable @remove="removeTag(tag)" />
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

      <NoteCalendar
        v-model:show="dateTimeOpen"
        :selected-day="dateValue"
        :selected-time="timeValue"
        @select="updateCreatedDate"
        @time="updateCreatedTime"
        @confirm="confirmDateTime"
      />

      <view class="editor-toolbar" :style="{ bottom: toolbarBottom, '--note-toolbar-inset': toolbarInset }" role="toolbar" aria-label="笔记编辑工具">
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
            @tap="hideKeyboard(); emojiOpen = false; tagOpen = true"
          >
            <NoteIcon name="tag" size="40rpx" />
          </button>
        </view>
        <button class="editor-tool" aria-label="常用短语" @mousedown.prevent @tap="hideKeyboard(); quickOpen = true"><NoteIcon name="quick" size="40rpx" /></button>
        <button v-if="aiAvailable && !isEdit" class="editor-tool" aria-label="AI 整理"
          :disabled="attachments.length > 0 || saving || listening" @mousedown.prevent @tap="openAi">
          <NoteIcon name="sparkles" size="40rpx" />
        </button>
        <view class="editor-toolbar__spacer" />
        <!-- #ifdef H5 -->
        <NoteVoiceInput v-if="aiAvailable && nativeSpeech" @text="text => editorCtx?.insertText({ text })" />
        <!-- #endif -->
        <button v-if="storage.mode === 'cloud' && voiceAvailable && keyboardHeight === 0 && !nativeSpeech"
          class="editor-tool"
          :class="{ 'editor-tool--active': listening }"
          :aria-pressed="listening"
          :aria-label="listening ? '结束语音输入' : '语音输入'"
          @mousedown.prevent
          @tap="listening ? stopVoice() : startVoice()"
        >
          <NoteIcon name="mic" size="42rpx" />
        </button>

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


      <NoteAssistant v-if="aiAvailable && !isEdit" v-model:show="aiOpen" action="split"
        :day="dayKey(createdAt)" :default-time="formatTime(createdAt)" :seed="plainText"
        :saving="saving" :save-error="aiError" @save="saveAi" />

      <NoteActionSheet
        v-model:show="imageSourceOpen"
        title="选择图片来源"
        :items="[
          { value: 'camera', label: '拍照', icon: 'camera' },
          {
  value: 'album', label: '从手机相册选择', icon: 'image'
}
        ]"
        @select="selectImageSource"
      />
      <NoteActionSheet
        :show="confirmOpen && confirmAction === 'delete'"
        title="删除笔记？"
        description="删除后无法恢复。"
        :items="[{ value: 'confirm', label: '删除这条笔记', icon: 'trash', danger: true }]"
        @update:show="confirmOpen = $event"
        @select="confirmEditorAction"
      />

      <NoteActionSheet
        :show="confirmOpen && confirmAction === 'discard'"
        title="退出编辑？"
        :description="attachments.some(item => !original?.images.includes(item.objectPath)) ? '草稿只保存文字和标签，新添加的图片不会保留。' : '可以保留草稿，下次继续编辑。'"
        cancel-text="继续编辑"
        :items="[
          ...(plainText.trim() || tags.length ? [{ value: 'draft', label: '保留草稿并退出', icon: 'journal' as const }] : []),
          { value: 'confirm', label: '放弃修改', icon: 'trash', danger: true }
        ]"
        @update:show="confirmOpen = $event"
        @select="$event === 'draft' ? keepDraftAndExit() : confirmEditorAction()"
      />

      <NoteSheet v-model:show="quickOpen" title="常用短语" label="选择或编辑常用短语">
        <view class="editor-sheet">
          <text class="editor-sheet__description">点击插入，内容可继续修改。</text>
          <view class="editor-phrase-list">
            <view v-for="phrase in quickPhrases" :key="phrase" class="editor-phrase-row">
              <button class="editor-phrase-insert" @tap="insertPhrase(phrase)">{{ phrase }}</button>
              <button class="editor-tool" :aria-label="`移除短语 ${phrase}`" @tap="removePhrase(phrase)"><NoteIcon name="close" size="24rpx" /></button>
            </view>
          </view>
          <view class="editor-tag-entry">
            <wd-input v-model="phraseInput" aria-label="新增常用短语" placeholder="添加常用短语…" :maxlength="30" clearable confirm-type="done" @confirm="addPhrase" />
            <wd-button :disabled="!phraseInput.trim() || quickPhrases.length >= 8" @click="addPhrase">添加</wd-button>
          </view>
        </view>
      </NoteSheet>

      <NoteSheet v-model:show="tagOpen" title="标签" label="为这条笔记添加或移除标签">
        <view class="editor-sheet">
          <text class="editor-sheet__description">用关键词整理记录，以后更容易查找。</text>
          <view class="editor-tag-entry">
            <wd-input
              v-model="tagInput"
              placeholder="输入标签名称…"
              :maxlength="MAX_TAG_LENGTH"
              clearable
              confirm-type="done"
              aria-label="标签名称"
              autocomplete="off"
              @confirm="addTag"
            >
            </wd-input>
            <wd-button type="primary" :disabled="!tagInput.trim()" @click="addTag">添加</wd-button>
          </view>

          <view v-if="suggestedTags.length" class="editor-suggestions">
            <text class="editor-suggestions__title">常用标签</text>
            <view class="editor-suggestions__list">
              <button
                v-for="tag in suggestedTags"
                :key="tag"
                class="editor-suggestion"
                :aria-label="`添加常用标签 ${tag}`"
                @tap="addSuggestedTag(tag)"
              >
                <NoteIcon name="add" size="28rpx" />
                {{ tag }}
              </button>
            </view>
          </view>

          <text v-if="tags.length" class="editor-suggestions__title editor-selected-title">已选标签 · {{ tags.length }}/{{ MAX_TAGS }}</text>
          <view v-if="tags.length" class="editor-tags editor-tags--panel" aria-label="已添加的标签">
            <NoteTag v-for="tag in tags" :key="tag" :label="tag" removable @remove="removeTag(tag)" />
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
.editor-draft-status {
  flex: 1;
  color: var(--note-text-2);
  font-size: var(--note-font-caption);
  text-align: left;
}
.editor-draft-restored {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16rpx;
  color: var(--note-text-2);
  font-size: var(--note-font-footnote);
}
.editor-draft-restored button {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 44px;
  min-height: 44px;
  padding: 0;
  margin: 0;
  border: 0;
  background: transparent;
  color: inherit;
}
.editor-draft-restored button::after {
  border: 0;
}
.editor-quick-start {
  display: flex;
  flex-wrap: wrap;
  gap: 8rpx;
  margin: 16rpx 0;
}
.editor-quick-start button {
  min-height: 44px;
  margin: 0;
  padding: 0 20rpx;
  border: 0;
  border-radius: 12px;
  background: var(--note-fill-2);
  color: var(--note-text-2);
  font-size: var(--note-font-subhead);
  line-height: 44px;
}
.editor-quick-start button::after, .editor-phrase-insert::after {
  border: 0;
}
.editor-quick-start button:active {
  background: var(--note-accent-soft);
  color: var(--note-accent);
}
.editor-phrase-list {
  margin: 20rpx 0;
}
.editor-phrase-row {
  display: flex;
  align-items: center;
  border-bottom: 1rpx solid var(--note-separator);
}
.editor-phrase-insert {
  flex: 1;
  min-width: 0;
  min-height: 48px;
  padding: 16rpx 0;
  margin: 0;
  border: 0;
  background: transparent;
  color: var(--note-text);
  text-align: left;
  font-size: var(--note-font-body);
}
.editor-phrase-insert:active {
  color: var(--note-accent);
}

.editor-page {
  padding-bottom: calc(80px + var(--note-inset-bottom));
  background: var(--note-surface);
}

.editor-date-title {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 44px;
  max-width: 100%;
  overflow: hidden;
  margin: 0;
  padding: 0 6rpx;
  border: 0;
  color: var(--note-accent);
  background: transparent;
  font-size: clamp(14px, 3.9vw, 17px);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.editor-date-title__label { overflow: hidden; text-overflow: ellipsis; }
.editor-date-title__icon { opacity: .75; transform: rotate(90deg); }
.editor-date-title:active { opacity: .7; }
.editor-date-title::after {
  border: 0;
}
:deep(.editor-page .note-navbar__title) {
  color: var(--note-accent);
  font-size: var(--note-font-title3);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.editor-nav-btn {
  height: 88rpx;
  min-height: 44px;
  margin: 0;
  padding: 0 20rpx;
  color: var(--note-accent);
  font-size: var(--note-font-body);
  font-weight: 500;
}

.editor-nav-btn--save {
  border: 0; background: transparent; line-height: 44px; font-weight: 700;
}
.editor-nav-btn--save:active:not([disabled]) { opacity: .6; }
.editor-nav-btn--save::after {
  border: 0;
}
.editor-nav-btn--save[disabled] {
  color: var(--note-text-3);
  background: transparent;
}

:deep(.editor-nav-btn .wd-button__content) {
  min-height: 44px;
}

.editor-body {
  padding: calc(var(--note-nav-height) + 12px) 32rpx 0;
}


.editor-paper {
  margin-top: 0;
  padding: 24rpx 8rpx 20rpx;
  border-radius: 0;
  border: 0;
  background: transparent;
  box-shadow: none;
}

.editor-richtext,
.editor-richtext :deep(.ql-editor) {
  width: 100%;
  min-height: clamp(160px, 26vh, 260px);
  color: var(--note-text);
  font-size: var(--note-font-body);
  line-height: 1.6;
}

.editor-richtext :deep(.ql-editor) {
  padding: 0 8px;
  overflow-wrap: anywhere;
}

.editor-richtext :deep(.ql-editor.ql-blank::before) {
  left: 8px;
  right: 8px;
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
  margin: 8rpx 0 16rpx;
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
  left: var(--note-inset-left);
  right: var(--note-inset-right);
  z-index: 35;
  display: flex;
  align-items: center;
  gap: 8rpx;
  height: calc(50px + var(--note-toolbar-inset, 0px));
  padding: 0 16rpx var(--note-toolbar-inset, 0px);
  overflow-x: auto;
  scrollbar-width: none;
  background: var(--note-material-thick);
  backdrop-filter: blur(20px) saturate(180%);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
  border-top: 1rpx solid var(--note-separator);
}

.editor-toolbar::-webkit-scrollbar {
  display: none;
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
  left: calc(12px + var(--note-inset-left));
  right: calc(12px + var(--note-inset-right));
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

.editor-voice__stop::after {
  border: 0;
}

.editor-sheet {
  padding: 8rpx 32rpx 24rpx;
}

.editor-sheet__description {
  display: block;
  color: var(--note-text-2);
  font-size: var(--note-font-footnote);
  line-height: 1.55;
}

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

.editor-selected-title {
  margin-top: 20rpx;
  margin-bottom: 6rpx;
  font-size: var(--note-font-footnote);
}

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
  padding: 0 16px;
  border: 1rpx solid var(--note-separator);
  border-radius: 12px;
  color: var(--note-text-2);
  background: var(--note-fill-2);
  font-size: var(--note-font-subhead);
  line-height: 1.3;
  transition: color var(--note-duration-fast) var(--note-ease), background-color var(--note-duration-fast) var(--note-ease);
}
.editor-suggestion::after { border: 0; }
.editor-suggestion:active { color: var(--note-accent); background: var(--note-accent-soft); }

.editor-emoji {
  position: fixed;
  left: var(--note-inset-left);
  right: var(--note-inset-right);
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
