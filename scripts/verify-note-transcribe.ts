// Run outside the app's npm workspace: deno run --no-config --no-lock --node-modules-dir=none --allow-env <absolute path to this file>
import assert from 'node:assert/strict'
import protobuf from 'npm:protobufjs@7.5.4'
import { handleNoteTranscription } from '../supabase/functions/note-transcribe/index.ts'

Deno.env.set('SUPABASE_URL', 'https://auth.test')
Deno.env.set('SUPABASE_ANON_KEY', 'public-test')
Deno.env.set('AI_BASE_URL', 'https://integrate.api.nvidia.com/v1')
Deno.env.set('AI_API_KEY', 'server-only-test')
const wire = protobuf.parse(`syntax="proto3";
message Config { string language_code=3; int32 max_alternatives=4; }
message Request { Config config=1; bytes audio=2; }
message Alternative { string transcript=1; }
message Result { repeated Alternative alternatives=1; }
message Response { repeated Result results=1; }`, { keepCase: true }).root
let allowed = true
let providerCalls = 0
const originalFetch = globalThis.fetch
globalThis.fetch = async (url, options) => {
  if (String(url).endsWith('/auth/v1/user')) return Response.json({ id: 'test-user' })
  if (String(url).endsWith('/get_note_cloud_access')) return Response.json(allowed ? 'allowed' : 'denied')
  providerCalls++
  assert.equal(new Headers(options?.headers).get('authorization'), 'Bearer server-only-test')
  const frame = options?.body as Uint8Array
  assert.equal(new DataView(frame.buffer).getUint32(1), frame.length - 5)
  const request = wire.lookupType('Request').toObject(wire.lookupType('Request').decode(frame.subarray(5)))
  assert.equal(request.config.language_code, 'zh', 'Language must survive protobuf encoding')
  assert.equal(request.config.max_alternatives, 1, 'Request one transcript instead of an empty candidate list')
  assert.equal(new TextDecoder().decode(request.audio.subarray(0, 4)), 'RIFF', 'Provider receives complete WAV')
  const type = wire.lookupType('Response')
  const message = type.encode(type.create({ results: [{ alternatives: [{ transcript: '今天喝水一杯。' }] }] })).finish()
  const body = new Uint8Array(5 + message.length)
  new DataView(body.buffer).setUint32(1, message.length); body.set(message, 5)
  return new Response(body, { headers: { 'content-type': 'application/grpc', 'grpc-status': '0' } })
}
function request(wav?: Uint8Array) {
  const form = new FormData()
  form.append('audio', new Blob([Uint8Array.from(wav || new Uint8Array(50))], { type: 'audio/wav' }), 'voice.wav')
  return new Request('https://notes.test', { method: 'POST', headers: { Authorization: 'Bearer session' }, body: form })
}
try {
  assert.equal((await handleNoteTranscription(new Request('https://notes.test', { method: 'POST' }))).status, 401)
  allowed = false
  assert.equal((await handleNoteTranscription(request())).status, 403)
  allowed = true
  assert.equal((await handleNoteTranscription(request())).status, 400)
  assert.equal(providerCalls, 0, 'Reject unauthorized or invalid audio before calling provider')
  const wav = new Uint8Array(32044), view = new DataView(wav.buffer)
  for (const [offset, text] of [[0, 'RIFF'], [8, 'WAVEfmt '], [36, 'data']] as const) wav.set(new TextEncoder().encode(text), offset)
  for (const [offset, number] of [[4, 32036], [16, 16], [24, 16000], [28, 32000], [40, 32000]]) view.setUint32(offset, number, true)
  for (const [offset, number] of [[20, 1], [22, 1], [32, 2], [34, 16]]) view.setUint16(offset, number, true)
  const response = await handleNoteTranscription(request(wav))
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { text: '今天喝水一杯。' })
  assert.equal(providerCalls, 1)
  console.log('PASS: authorization, WAV validation, Chinese protobuf request and transcript response')
} finally { globalThis.fetch = originalFetch }
