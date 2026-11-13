import assert from 'node:assert/strict'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright'

const base = process.env.NOTE_REVIEW_URL || 'http://localhost:5174'
const chrome = join(process.env.ProgramFiles || '', 'Google/Chrome/Application/chrome.exe')
const browser = await chromium.launch({ executablePath: process.env.NOTE_BROWSER_EXECUTABLE || (existsSync(chrome) ? chrome : undefined) })
const output = 'artifacts/note-assistant-review'
mkdirSync(output, { recursive: true })
const id = '11111111-1111-4111-8111-111111111111'
const older = { id, user_id: 'test-owner', created_at: '2026-09-09T04:00:00Z', updated_at: '2026-09-09T04:00:00Z',
  content: '旧笔记：山药粥', content_text: '旧笔记：山药粥', images: [], tags: [], mood: 'calm' }

try {
  for (const width of [320, 393]) {
    const context = await browser.newContext({ viewport: { width, height: 852 }, reducedMotion: 'reduce' })
    const page = await context.newPage()
    const errors = []
    let mode = 'local'
    let access = 'allowed'
    let writes = 0
    let aiCalls = 0
    let saveAttempt
    let originalBatch
    const todayRow = { ...older, id: '22222222-2222-4222-8222-222222222222', created_at: new Date().toISOString(), content: '当前笔记', content_text: '当前笔记' }
    page.on('pageerror', error => errors.push(error.message))
    page.setDefaultTimeout(12_000)
    await page.route('**/rest/v1/rpc/get_note_cloud_access', route => route.fulfill({
      json: route.request().headers().authorization === 'Bearer assistant-token' ? access : 'login'
    }))
    await page.route('**/rest/v1/notes*', route => {
      const request = route.request()
      const url = new URL(request.url())
      if (request.method() === 'POST') {
        assert.equal(mode, 'cloud')
        assert.equal(request.headers().authorization, 'Bearer assistant-token')
        const batch = request.postDataJSON()
        assert.equal(batch.length, 2)
        assert.equal(batch[0].content, '喝奶180毫升')
        assert.equal(batch[1].content, '排便一次')
        assert(batch.every(row => row.id && row.created_at && !('user_id' in row)))
        if (!originalBatch) {
          originalBatch = batch
          return route.fulfill({ status: 503, json: { message: '测试网络错误，请重试' } })
        }
        assert.deepEqual(batch, originalBatch)
        assert.match(request.headers().prefer, /ignore-duplicates/)
        writes++
        return route.fulfill({ status: 201 })
      }
      return route.fulfill({ json: url.searchParams.has('id') ? [older] : [todayRow] })
    })
    await page.route('**/functions/v1/note-assistant', route => {
      assert.equal(mode, 'cloud')
      assert.equal(route.request().headers().authorization, 'Bearer assistant-token')
      aiCalls++
      const data = route.request().postDataJSON()
      if (data.action === 'split') return route.fulfill({ json: { entries: [
        { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', text: '喝奶180毫升', day: data.day, time: '07:00' },
        { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', text: '排便一次', day: data.day, time: null }
      ] } })
      if (data.action === 'summary') return route.fulfill({ json: {
        count: 1, truncated: false, highlights: [{ text: '当天有一条记录', sources: [todayRow] }]
      } })
      assert.equal(data.action, 'search')
      assert.equal(data.text, '山药粥')
      return route.fulfill({ json: { rows: [older], truncated: false } })
    })
    await page.goto(base)
    await page.locator('.tl-strip').waitFor()
    assert.equal(await page.getByText('当天小结', { exact: true }).count(), 0)
    await page.locator('[aria-label="搜索笔记"]').click()
    assert.equal(await page.getByText('智能搜索', { exact: true }).count(), 0)
    await page.locator('[aria-label="写一条新笔记"]').click()
    await page.locator('.editor-toolbar').waitFor()
    assert.equal(await page.locator('[aria-label="AI 整理"]').count(), 0)
    assert.equal(aiCalls, 0)

    mode = 'cloud'
    await page.evaluate(() => {
      uni.setStorageSync('note-storage-mode', 'cloud')
      uni.setStorageSync('note-session', JSON.stringify({
        access_token: 'assistant-token', refresh_token: 'refresh', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: 'test-owner' }
      }))
    })
    await page.goto(base)
    await page.reload()
    await page.locator('.tl-ai-link').getByText('当天小结', { exact: true }).click()
    await page.getByText('生成小结', { exact: true }).click()
    await page.getByText('当天有一条记录', { exact: true }).waitFor()
    assert.equal(await page.locator('.note-ai__source').count(), 1)
    await page.screenshot({ path: `${output}/summary-${width}.png` })
    await page.getByText('完成', { exact: true }).click()
    await page.locator('.note-sheet__panel').waitFor({ state: 'hidden' })

    await page.locator('[aria-label="搜索笔记"]').click()
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    const searchActionBounds = await page.locator('.tl-ai-link--search').boundingBox()
    assert(searchActionBounds && searchActionBounds.y >= 0 && searchActionBounds.y + searchActionBounds.height < 852,
      'AI search must remain reachable after scrolling while search is open')
    await page.locator('.tl-ai-link--search').click()
    await page.locator('.note-ai textarea').fill('山药粥')
    await page.locator('.note-ai__submit').click()
    await page.getByText(/旧笔记：山药粥/).click()
    await page.locator('.ql-editor').getByText('旧笔记：山药粥', { exact: true }).waitFor()
    await page.locator('[aria-label="取消编辑"]').click()
    await page.locator('.tl-searchbar__cancel').click()

    await page.locator('[aria-label="写一条新笔记"]').click()
    await page.locator('[aria-label="AI 整理"]').click()
    await page.locator('.note-ai textarea').fill('7点喝奶180毫升，排便一次')
    await page.getByText('整理文字', { exact: true }).click()
    await page.getByText('保存 2 条', { exact: true }).waitFor()
    assert.equal(writes, 0)
    assert.equal(originalBatch, undefined, 'no write before explicit confirmation')
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width)
    await page.screenshot({ path: `${output}/split-${width}.png` })
    await page.getByText('保存 2 条', { exact: true }).click()
    await page.getByText('测试网络错误，请重试', { exact: true }).waitFor()
    saveAttempt = page.waitForResponse(response => response.url().includes('on_conflict=id') && response.status() === 201)
    await page.getByText('保存 2 条', { exact: true }).click()
    await saveAttempt
    await page.locator('.tl-strip').waitFor()
    assert.equal(writes, 1)
    assert.equal(aiCalls, 3)
    access = 'denied'
    await page.reload()
    await page.getByText('云端存储不可用', { exact: true }).waitFor()
    assert.equal(await page.getByText('当天小结', { exact: true }).count(), 0)
    assert.deepEqual(errors, [])
    await context.close()
  }
  console.log('Passed at 320px and 393px: local/denied gating, summary sources, older search results, preview, batch save and retry')
} finally {
  await browser.close()
}
