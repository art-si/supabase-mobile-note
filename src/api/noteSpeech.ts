import { SUPABASE_URL, SUPABASE_KEY, ApiRequestError } from './supabase'

export async function transcribeNoteAudio(token: string, audio: Blob, signal: AbortSignal): Promise<string> {
  if (!audio.size || audio.size > 2_080_044) throw new Error('录音无效，请控制在 60 秒内')
  if (!/wav/i.test(audio.type)) throw new Error('录音格式不兼容，请更新应用后重试')
  const form = new FormData()
  form.append('audio', audio, 'note-voice.wav')
  const response = await fetch(`${SUPABASE_URL}/functions/v1/note-transcribe`, {
    method: 'POST', headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${token}` }, body: form, signal
  })
  const result: unknown = await response.json()
  if (!response.ok) throw new ApiRequestError(result, '语音转写未完成，请稍后重试')
  if (!result || typeof result !== 'object' || !('text' in result) || typeof result.text !== 'string' || !result.text.trim()) {
    throw new Error('没有听清，请再说一次')
  }
  return result.text.trim()
}
