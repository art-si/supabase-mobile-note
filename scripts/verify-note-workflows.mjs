import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
const executablePath = process.env.NOTE_BROWSER_EXECUTABLE || join(process.env.ProgramFiles || '', 'Google/Chrome/Application/chrome.exe')
const browser = await chromium.launch({ headless: true, executablePath: existsSync(executablePath) ? executablePath : undefined })
const base = process.env.NOTE_REVIEW_URL || 'http://localhost:5174'
const output = 'artifacts/mobile-review'
mkdirSync(output, { recursive: true })
try {
  const context = await browser.newContext({ viewport: { width: 393, height: 852 }, permissions: ['clipboard-read', 'clipboard-write'] })
  const page = await context.newPage()
  await page.route('**/rest/v1/rpc/get_note_cloud_access', route => route.fulfill({ json: 'login' }))
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  await page.goto(base)
  await page.evaluate(() => {
    const now = new Date()
    const image = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="400"><rect width="300" height="400" fill="#dae8dd"/><circle cx="150" cy="200" r="100" fill="#b6cdbc"/><text x="150" y="205" text-anchor="middle" font-size="24" fill="#263d31">笔记图片</text></svg>')
    const entries = ['散步回来，记录一下今天的心情。', '午饭后走了走。', '读书，喝茶。'].map((content, i) => ({ id: 'review-' + i, content, contentText: content, userId: 'local-device', mood: 'calm', images: i === 1 ? [image] : [], tags: [], createdAt: now.toISOString(), updatedAt: now.toISOString() }))
    const yesterday = new Date(now); yesterday.setDate(yesterday.getDate() - 1)
    entries.push({ ...entries[0], id: 'yesterday', content: '昨天的记录', contentText: '昨天的记录', createdAt: yesterday.toISOString() })
    localStorage.setItem('note-local-entries', JSON.stringify({ type: 'object', data: entries }))
  })
  await page.reload()
  await page.locator('.tl-entry').first().waitFor()
  assert.equal(await page.locator('.tl-entry').count(), 3)
  assert.equal(await page.locator('.tl-strip__all').count(), 0)
  assert.equal(await page.locator('.tl-strip__day--today').getAttribute('aria-pressed'), 'true')
  assert.equal(await page.locator('.tl-card').first().evaluate(e => getComputedStyle(e).boxShadow), 'none')
  await page.screenshot({ path: output + '/updated-timeline.png', fullPage: true })
  await page.locator('[aria-label="写一条新笔记"]').click()
  const save = page.locator('.editor-nav-btn--save')
  assert.equal(await save.getAttribute('disabled'), 'true')
  const content = '粘贴后直接完成保存\n第二行内容'
  await page.evaluate(text => navigator.clipboard.writeText(text), content)
  await page.locator('.ql-editor').click()
  await page.keyboard.press('Control+V')
  await page.waitForFunction(() => !document.querySelector('.editor-nav-btn--save').hasAttribute('disabled'))
  assert.equal(await page.locator('[aria-label="语音输入"]').count(), 0)
  assert.equal(await page.locator('[aria-label="图片识别工具"]').count(), 0)
  await save.click()
  await page.locator('.tl-card__rich').filter({ hasText: '粘贴后直接完成保存' }).waitFor()
  await context.close()

  // Configuration failures remain distinguishable and retryable, without touching the server.
  const offline = await browser.newContext({ viewport: { width: 393, height: 852 } })
  const settings = await offline.newPage()
  let fail = true
  let legacyReads = 0
  await settings.route('**/rest/v1/rpc/get_note_cloud_access', route => fail ? route.abort('failed') : route.fulfill({
    status: 404, json: { code: 'PGRST202', message: 'Could not find the function in the schema cache' }
  }))
  await settings.route('**/rest/v1/sys_param?*', route => {
    legacyReads++
    return route.fulfill({ json: [{ param_value: { noteStorageCloudEnabled: true } }] })
  })
  await settings.goto(base + '/#/pages/mine/index')
  const retry = settings.getByText('重新获取云端配置', { exact: true })
  await retry.waitFor()
  fail = false
  await retry.click()
  await settings.getByText('云端存储', { exact: true }).waitFor()
  assert.equal(await retry.count(), 0)
  assert.equal(legacyReads, 1)
  await offline.close()
  assert.deepEqual(errors, [])
  console.log('Passed: today default, timeline/images, real clipboard paste/save, local tool visibility, configuration retry')
} finally {
  await browser.close()
}
