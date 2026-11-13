import assert from 'node:assert/strict'
import { handleNoteAssistant } from '../supabase/functions/note-assistant/handler.ts'

const env = name => ({
  SUPABASE_URL: 'https://supabase.test', SUPABASE_ANON_KEY: 'anon',
  AI_BASE_URL: 'https://models.test/v1', AI_API_KEY: 'server-only', AI_MODEL: 'test'
})[name]
const note = { id: 'note-1', created_at: '2026-11-13T04:00:00Z', content_text: '喝奶 180 毫升', tags: ['喂养'] }
let allowed = false
let providerCalls = 0
let dataCalls = 0
let result = {}
let completion
let providerFailure
let providerInput
let notesQuery
globalThis.fetch = async (path, init) => {
  const url = new URL(path)
  if (url.host === 'models.test') {
    providerCalls++
    assert.equal(init.headers.Authorization, 'Bearer server-only')
    providerInput = JSON.parse(JSON.parse(init.body).messages[1].content)
    if (providerFailure) throw providerFailure
    return Response.json({ choices: [{ message: completion ?? { content: JSON.stringify(result) } }] })
  }
  assert.equal(init.headers.Authorization, 'Bearer session')
  if (url.pathname === '/auth/v1/user') return Response.json({ id: 'owner' })
  if (url.pathname.endsWith('get_note_cloud_access')) return Response.json(allowed ? 'allowed' : 'denied')
  dataCalls++
  assert.equal(url.searchParams.get('user_id'), 'eq.owner')
  notesQuery = url.searchParams
  return Response.json([note])
}
const request = (body, token = 'session') => handleNoteAssistant(new Request('https://function.test', {
  method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {},
  body: JSON.stringify({ timezone: 'Asia/Shanghai', offset: -480, ...body })
}), env)

assert.equal((await request({ action: 'summary' }, '')).status, 401)
assert.equal((await request({ action: 'summary' })).status, 403)
assert.equal(providerCalls + dataCalls, 0)
allowed = true
result = { entries: [{ text: '喝奶 180 毫升', day: '2026-11-13', time: '07:00' }, { text: '排便', day: '2026-11-31', time: '27:00' }] }
const split = await (await request({ action: 'split', text: '7点喝奶180毫升，排便', day: '2026-11-13' })).json()
assert.deepEqual(split.entries.map(({ day, time }) => [day, time]), [['2026-11-13', '07:00'], ['2026-11-13', null]])
assert.equal(dataCalls, 0)
result = { highlights: [{ text: '记录了喂奶', sources: [1, 2] }, { text: '无依据', sources: [3] }] }
const summary = await (await request({ action: 'summary', day: '2026-11-13', userId: 'other' })).json()
assert.deepEqual(notesQuery.getAll('created_at'), ['gte.2026-11-12T16:00:00.000Z', 'lt.2026-11-13T16:00:00.000Z'])
assert.deepEqual(summary.highlights, [{ text: '记录了喂奶', sources: [note] }])
assert.deepEqual(providerInput, [{ source: 1, text: note.content_text, tags: note.tags }])
result = { from: '2026-11-13', to: '2026-11-13', terms: ['喝奶', '喂养'] }
const search = await (await request({ action: 'search', text: '13号喂奶', userId: 'other' })).json()
assert.deepEqual(search.rows, [note])
assert.equal(providerInput.question, '13号喂奶')
assert(notesQuery.get('or').includes('content_text.ilike.*喝奶*'))
assert(!JSON.stringify(providerInput).includes(note.content_text))
completion = { content: [{ text: '<think>hidden</think>\n结果如下：\n```json\n{"terms":["山药粥"]}\n```' }] }
assert.equal((await request({ action: 'search', text: '山药粥' })).status, 200)
completion = { content: 'not JSON' }
const malformed = await request({ action: 'search', text: '山药粥' })
assert.equal(malformed.status, 502)
assert.match((await malformed.json()).message, /格式/)
providerFailure = new DOMException('timeout', 'TimeoutError')
assert.equal((await request({ action: 'search', text: '山药粥' })).status, 504)
console.log('Passed: authenticated cloud gate, split validation, timezone, RLS-scoped records, source validation and structured search')
