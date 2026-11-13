import protobuf from 'npm:protobufjs@7.5.4'

// Wire-compatible subset of NVIDIA Riva's MIT-licensed riva_asr.proto.
// https://github.com/nvidia-riva/common/blob/main/riva/proto/riva_asr.proto
const proto = protobuf.parse(`syntax = "proto3";
message Config { int32 encoding = 1; int32 sample_rate_hertz = 2; string language_code = 3; int32 max_alternatives = 4; bool enable_automatic_punctuation = 11; }
message Request { Config config = 1; bytes audio = 2; }
message Alternative { string transcript = 1; }
message Result { repeated Alternative alternatives = 1; }
message Response { repeated Result results = 1; }`).root
const input = proto.lookupType('Request')
const output = proto.lookupType('Response')
const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Cache-Control': 'no-store', 'Content-Type': 'application/json'
}
const MAX_BYTES = 2_100_000
const requests = new Map<string, number[]>()
class Failure extends Error {
  constructor(readonly status: number, message: string) { super(message) }
}
function json(status: number, value: unknown) {
  return new Response(JSON.stringify(value), { status, headers })
}

async function recognize(audio: Uint8Array, key: string, signal: AbortSignal): Promise<string> {
  const message = input.encode(input.create({ config: { languageCode: 'zh', maxAlternatives: 1, enableAutomaticPunctuation: true }, audio })).finish()
  // Unary gRPC uses one uncompressed length-prefixed protobuf message over HTTP/2.
  const frame = new Uint8Array(5 + message.length)
  new DataView(frame.buffer).setUint32(1, message.length)
  frame.set(message, 5)
  const response = await fetch('https://grpc.nvcf.nvidia.com/nvidia.riva.asr.RivaSpeechRecognition/Recognize', {
    method: 'POST', headers: {
      authorization: `Bearer ${key}`, 'function-id': 'b702f636-f60c-4a3d-a6f4-f3568c13bd7d',
      'content-type': 'application/grpc', 'te': 'trailers', 'grpc-timeout': '45S'
    }, body: frame, signal: AbortSignal.any([signal, AbortSignal.timeout(48_000)])
  })
  const bytes = new Uint8Array(await response.arrayBuffer())
  const grpcStatus = response.headers.get('grpc-status')
  if (!response.ok || (grpcStatus !== null && grpcStatus !== '0') ||
    !response.headers.get('content-type')?.startsWith('application/grpc') ||
    bytes.length < 5 || bytes[0] !== 0 || new DataView(bytes.buffer).getUint32(1) !== bytes.length - 5) {
    console.warn('[note-transcribe] provider status', response.status, grpcStatus)
    throw new Failure(502, '语音服务暂时不可用，请稍后重试')
  }
  const result = output.toObject(output.decode(bytes.subarray(5))) as { results?: { alternatives?: { transcript?: string }[] }[] }
  return (result.results || []).map(row => row.alternatives?.[0]?.transcript || '').join('').trim()
}

export async function handleNoteTranscription(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers })
  try {
    if (req.method !== 'POST') throw new Failure(405, '请求方式无效')
    const authorization = req.headers.get('authorization')
    if (!authorization?.startsWith('Bearer ')) throw new Failure(401, '请登录云端后使用语音输入')
    const auth = { Authorization: authorization, apikey: Deno.env.get('SUPABASE_ANON_KEY') || '' }
    const url = Deno.env.get('SUPABASE_URL')
    const user = await fetch(`${url}/auth/v1/user`, { headers: auth, signal: AbortSignal.timeout(7_000) })
    if (!user.ok) throw new Failure(401, '请重新登录云端后使用语音输入')
    const { id } = await user.json()
    if (typeof id !== 'string' || !id) throw new Failure(401, '请重新登录云端')
    const access = await fetch(`${url}/rest/v1/rpc/get_note_cloud_access`, { headers: auth, signal: AbortSignal.timeout(7_000) })
    if (!access.ok) throw new Failure(503, '暂时无法核实云端权限，请重试')
    if (await access.json() !== 'allowed') throw new Failure(403, '当前账号未获云端笔记授权')
    const recent = (requests.get(id) || []).filter(time => Date.now() - time < 60_000)
    if (recent.length >= 8) throw new Failure(429, '语音输入过于频繁，请稍后再试')
    if (requests.size >= 1024) for (const [key, times] of requests) if (Date.now() - times.at(-1)! >= 60_000) requests.delete(key)
    if (requests.size >= 1024 && !requests.has(id)) throw new Failure(429, '语音服务繁忙，请稍后重试')
    recent.push(Date.now()); requests.set(id, recent)
    const apiKey = Deno.env.get('AI_API_KEY')?.trim()
    const base = Deno.env.get('AI_BASE_URL') || ''
    if (!apiKey || !/^https:\/\/[^/]*nvidia\.com(?:\/|$)/i.test(base)) throw new Failure(503, '云端语音服务尚未配置')
    if (!req.body || Number(req.headers.get('content-length')) > MAX_BYTES) throw new Failure(413, '录音过长，请控制在 60 秒内')
    const chunks: Uint8Array[] = []; let size = 0
    const reader = req.body.getReader()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.length
      if (size > MAX_BYTES) { await reader.cancel(); throw new Failure(413, '录音过长，请控制在 60 秒内') }
      chunks.push(value)
    }
    const data = new Uint8Array(size); let position = 0
    for (const chunk of chunks) { data.set(chunk, position); position += chunk.length }
    let form: FormData
    try { form = await new Response(data, { headers: { 'Content-Type': req.headers.get('content-type') || '' } }).formData() }
    catch { throw new Failure(400, '录音格式无效，请重新按住说话') }
    const audio = form.get('audio')
    if (!(audio instanceof File) || audio.size < 48 || audio.size > 2_080_044) throw new Failure(400, '录音无效，请重新按住说话')
    const wav = new Uint8Array(await audio.arrayBuffer())
    const view = new DataView(wav.buffer)
    const label = (start: number, end: number) => new TextDecoder().decode(wav.subarray(start, end))
    // The app records canonical PCM WAV: 16 kHz, mono, signed 16-bit, up to 65 seconds.
    if (label(0, 4) !== 'RIFF' || label(8, 16) !== 'WAVEfmt ' || view.getUint32(16, true) !== 16 ||
      view.getUint16(20, true) !== 1 || view.getUint16(22, true) !== 1 || view.getUint32(24, true) !== 16000 ||
      view.getUint16(34, true) !== 16 || label(36, 40) !== 'data' || view.getUint32(40, true) !== wav.length - 44) {
      throw new Failure(400, '录音格式无效，请更新应用后重试')
    }
    const text = await recognize(wav, apiKey, req.signal)
    if (!text) throw new Failure(422, '没有听清，请再说一次')
    return json(200, { text })
  } catch (error) {
    if (error instanceof Failure) return json(error.status, { message: error.message })
    if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
      return json(504, { message: '语音转写超时，请重试' })
    }
    console.warn('[note-transcribe] request failed', error instanceof Error ? error.name : 'unknown')
    return json(502, { message: '语音转写未完成，请稍后重试' })
  }
}

if (import.meta.main) Deno.serve(handleNoteTranscription)
