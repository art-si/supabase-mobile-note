<script setup lang="ts">
import { ref, onBeforeUnmount } from 'vue'
import { registerPlugin } from '@capacitor/core'
import { useAuthStore } from '@/stores/auth'
import { useNoteAssistant } from '@/composables/useNoteAssistant'
import { transcribeNoteAudio } from '@/api/noteSpeech'
import { getUserFacingErrorMessage } from '@/api/supabase'
import NoteIcon from './NoteIcon.vue'
import NoteSheet from './NoteSheet.vue'
const speech = registerPlugin<{ start(): Promise<void>; stop(): Promise<{ data: string; mimeType: string }>; cancel(): Promise<void> }>('NoteSpeech')
const emit = defineEmits<{ text: [string] }>()
const auth = useAuthStore()
const { cloudToken } = useNoteAssistant()
const open = ref(false)
const holding = ref(false)
const cancelling = ref(false)
const busy = ref(false)
const error = ref('')
let origin = 0
let owner = ''
let sequence = 0
let active = false
let recording: Promise<void> | null = null
let controller: AbortController | null = null
let timer: ReturnType<typeof setTimeout> | undefined
function show() { uni.hideKeyboard(); open.value = true }
async function begin(event?: TouchEvent) {
  if (active || busy.value) return
  const current = ++sequence
  origin = event?.touches[0]?.clientY || 0
  owner = auth.user?.id || ''
  active = true; holding.value = true; cancelling.value = false; error.value = ''
  recording = (async () => {
    await cloudToken()
    if (current !== sequence) throw new Error('已取消')
    await speech.start()
    if (current !== sequence) { await speech.cancel(); throw new Error('已取消') }
  })()
  timer = setTimeout(() => { void finish() }, 60_000)
  try { await recording }
  catch (cause) {
    if (current === sequence) {
      error.value = getUserFacingErrorMessage(cause, '无法开始录音，请重试')
      active = false; holding.value = false; busy.value = false; clearTimeout(timer)
    }
  }
}
function move(event: TouchEvent) { cancelling.value = origin - (event.touches[0]?.clientY || origin) > 64 }
async function finish() {
  if (!holding.value) return
  const current = sequence
  const cancel = cancelling.value
  holding.value = false; busy.value = true; clearTimeout(timer)
  try {
    if (cancel) { sequence++; await speech.cancel(); return }
    await recording
    if (current !== sequence) return
    const audio = await speech.stop()
    const bytes = Uint8Array.from(atob(audio.data), char => char.charCodeAt(0))
    const token = await cloudToken()
    if (current !== sequence || owner !== auth.user?.id) return
    controller = new AbortController()
    timer = setTimeout(() => controller?.abort(), 55_000)
    const text = await transcribeNoteAudio(token, new Blob([bytes], { type: audio.mimeType }), controller.signal)
    if (current === sequence && owner === auth.user?.id) { emit('text', text); open.value = false }
  } catch (cause) {
    if (current === sequence) error.value = getUserFacingErrorMessage(cause, '语音转写未完成，请检查网络后重试')
  } finally {
    if (current === sequence || cancel) { clearTimeout(timer); active = false; busy.value = false; cancelling.value = false }
  }
}
function close(value: boolean) {
  if (!value) {
    sequence++; clearTimeout(timer); controller?.abort();
    active = false; holding.value = false; busy.value = false; cancelling.value = false
    void speech.cancel().catch(() => {})
  }
  open.value = value
}
onBeforeUnmount(() => close(false))
</script>
<template>
  <button class="voice-icon" aria-label="语音输入" @mousedown.prevent @tap="show"><NoteIcon name="mic" size="42rpx" /></button>
  <NoteSheet :show="open" title="语音输入" @update:show="close">
    <view class="voice-panel">
      <text role="status">{{ busy ? '正在转文字…' : holding ? cancelling ? '松开取消' : '松开转文字，上滑取消' : '按住说话，松开后转为文字' }}</text>
      <button class="voice-hold" :class="{ 'voice-hold--cancel': cancelling }" :disabled="busy" aria-label="按住说话"
        @touchstart.prevent="begin($event)" @touchmove.prevent="move" @touchend.prevent="finish"
        @touchcancel="cancelling = true; finish()" @keydown.space.prevent="begin()" @keyup.space.prevent="finish">
        <NoteIcon name="mic" size="56rpx" />{{ holding ? '松开结束' : '按住说话' }}
      </button>
      <text v-if="error" class="voice-error" role="alert">{{ error }}</text>
      <text class="voice-hint">文字会填入编辑区，确认后再保存。录音将发送至云端转写，单次最长 60 秒。</text>
    </view>
  </NoteSheet>
</template>
<style scoped>
.voice-icon { display:flex;align-items:center;justify-content:center;min-width:44px;min-height:44px;padding:0;border:0;background:transparent;color:var(--note-text-2);margin:0 }
.voice-icon::after,.voice-hold::after{border:0}
.voice-panel{display:grid;gap:20px;padding:16px 20px 32px;text-align:center;color:var(--note-text)}
.voice-hold{display:flex;align-items:center;justify-content:center;gap:12px;min-height:88px;margin:0;width:100%;border:0;border-radius:var(--note-radius-md);background:var(--note-accent-soft);color:var(--note-accent);touch-action:none;user-select:none}
.voice-hold--cancel,.voice-error{color:var(--note-danger)}
.voice-hint{font-size:var(--note-font-footnote);color:var(--note-text-2);line-height:1.5}
</style>
