import assert from 'node:assert/strict'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright'

const base = process.env.NOTE_REVIEW_URL || 'http://localhost:5174'
const chrome = join(process.env.ProgramFiles || '', 'Google/Chrome/Application/chrome.exe')
const browser = await chromium.launch({ executablePath: existsSync(chrome) ? chrome : undefined })
const output = 'artifacts/note-assistant-review'
mkdirSync(output, { recursive: true })
try {
  const context = await browser.newContext({ viewport: { width: 320, height: 800 }, reducedMotion: 'reduce' })
  const page = await context.newPage()
  const now = new Date().toISOString()
  const photo = 'https://backup.example.test/photo.png'
  let failImage = true
  let photoDownloads = 0
  let remoteWrites = 0
  const records = Array.from({ length: 41 }, (_, index) => ({
    id: String(index + 1).padStart(2, '0'), created_at: now, updated_at: now, mood: 'calm', tags: [],
    content: `云端测试记录 ${index + 1}`, content_text: `云端测试记录 ${index + 1}`,
    images: index === 40 ? ['test-owner/photo.png'] : []
  }))
  await page.route('**/rest/v1/rpc/get_note_cloud_access', route => route.fulfill({
    json: route.request().headers().authorization === 'Bearer backup-token' ? 'allowed' : 'login'
  }))
  await page.route('**/rest/v1/sys_user?*', route => route.fulfill({ json: [] }))
  await page.route('**/rest/v1/notes*', route => {
    if (route.request().method() !== 'GET') remoteWrites++
    const params = new URL(route.request().url()).searchParams
    assert.equal(params.get('user_id'), 'eq.test-owner')
    const after = params.get('id')?.slice(3) || ''
    return route.fulfill({ json: records.filter(note => note.id > after).slice(0, Number(params.get('limit'))) })
  })
  await page.route('**/storage/v1/object/sign/note-images', route => route.fulfill({ json: [{ path: 'test-owner/photo.png', signedURL: photo }] }))
  await page.route(photo, route => {
    photoDownloads++
    return failImage
      ? route.fulfill({ status: 503, headers: { 'access-control-allow-origin': '*' } })
      : route.fulfill({ headers: { 'access-control-allow-origin': '*' }, contentType: 'image/png',
          body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==', 'base64') })
  })
  await page.addInitScript(({ now }) => {
    if (localStorage.getItem('note-storage-mode')) return
    const set = (key, data) => localStorage.setItem(key, JSON.stringify({ type: typeof data, data }))
    set('note-storage-mode', 'cloud')
    set('note-session', JSON.stringify({ access_token: 'backup-token', refresh_token: 'fixture', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: 'test-owner' } }))
    set('note-local-entries', [{ id: 'local-original', userId: 'local-device', content: '保留本机笔记', createdAt: now, updatedAt: now, images: [], tags: [] }])
  }, { now })
  await page.goto(base + '/#/pages/mine/index')
  const open = () => page.locator('.mine-import').filter({ hasText: '备份到本机' }).click()
  const click = label => page.locator('.mine-backup__submit').getByText(label, { exact: true }).click()
  await open()
  await click('开始备份')
  await page.getByText(/图片下载失败/).waitFor()
  assert.match(await page.locator('.mine-backup').innerText(), /新增 40 条/)
  failImage = false
  await click('重试备份')
  await page.getByText(/备份完成/).waitFor()
  assert.match(await page.locator('.mine-backup').innerText(), /新增 1 条 · 更新 0 条 · 跳过 40 条/)
  assert.equal(photoDownloads, 2)
  await page.screenshot({ path: output + '/backup-320.png' })
  const saved = await page.evaluate(() => uni.getStorageSync('note-local-entries'))
  assert.equal(saved.length, 42)
  assert.equal(saved.find(row => row.id === 'local-original').content, '保留本机笔记')
  const path = saved.find(row => row.content === '云端测试记录 41').images[0]
  assert.match(path, /^note-local-image:\/\//)
  await page.evaluate(async () => { await import('/src/api/localNoteImages.ts') })
  await context.setOffline(true)
  assert.equal(await page.evaluate(async path => {
    const { resolveLocalNoteImage } = await import('/src/api/localNoteImages.ts')
    const url = await resolveLocalNoteImage(path)
    return (await (await fetch(url)).blob()).type
  }, path), 'image/png')
  await context.setOffline(false)
  await click('完成')
  await page.locator('.note-sheet__panel').waitFor({ state: 'hidden' })
  records[0].content = records[0].content_text = '云端已更新'
  records[0].updated_at = new Date(Date.now() + 1000).toISOString()
  await open()
  await click('开始备份')
  await page.getByText(/备份完成/).waitFor()
  assert.match(await page.locator('.mine-backup').innerText(), /新增 0 条 · 更新 1 条 · 跳过 40 条/)
  assert.equal(photoDownloads, 2)
  assert.equal(remoteWrites, 0)
  assert.equal(await page.evaluate(() => uni.getStorageSync('note-local-entries').length), 42)
  await click('完成')
  await page.locator('.note-sheet__panel').waitFor({ state: 'hidden' })
  await page.evaluate(async () => {
    const { updateLocalNote } = await import('/src/api/localNotes.ts')
    updateLocalNote('cloud-backup-test-owner-01', { content: '我修改的本机副本', mood: 'calm', images: [], tags: [] })
  })
  records[0].content = records[0].content_text = '云端再次更新'
  records[0].updated_at = new Date(Date.now() + 2000).toISOString()
  await open()
  await click('开始备份')
  await page.getByText(/备份完成/).waitFor()
  assert.match(await page.locator('.mine-backup').innerText(), /新增 0 条 · 更新 0 条 · 跳过 41 条/)
  assert.equal(await page.evaluate(() => uni.getStorageSync('note-local-entries').find(note => note.id === 'cloud-backup-test-owner-01').content), '我修改的本机副本')
  await click('完成')
  await page.evaluate(() => uni.setStorageSync('note-storage-mode', 'local'))
  await page.reload()
  await page.getByText('本机存储', { exact: true }).waitFor()
  assert.equal(await page.getByText('备份到本机', { exact: true }).count(), 0)
  console.log('Passed: 41 cloud rows across pages, offline image, failure retry, no duplicates, cloud update, local preservation, no remote writes')
} finally {
  await browser.close()
}
