import assert from 'node:assert/strict'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright'

// Run against the H5 dev server; all notes stay in this isolated browser context.
const base = process.env.NOTE_REVIEW_URL || 'http://localhost:5174'
const chrome = join(process.env.ProgramFiles || '', 'Google/Chrome/Application/chrome.exe')
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.NOTE_BROWSER_EXECUTABLE || (existsSync(chrome) ? chrome : undefined)
})
const output = 'artifacts/mobile-review'
mkdirSync(output, { recursive: true })

try {
  const context = await browser.newContext({ viewport: { width: 393, height: 852 }, reducedMotion: 'reduce' })
  const page = await context.newPage()
  page.setDefaultTimeout(8000)
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/rest/v1/rpc/get_note_cloud_access', route => route.fulfill({ json: 'closed' }))
  await page.goto(`${base}/#/pages/timeline/index`)
  await page.locator('.tl-strip').waitFor()
  await page.evaluate(() => {
    const now = new Date().toISOString()
    localStorage.setItem('note-local-entries', JSON.stringify({ type: 'object', data: [{
      id: 'loading-review', userId: 'local-device', content: '已有记录', contentText: '已有记录',
      mood: 'calm', images: [], tags: [], createdAt: now, updatedAt: now
    }] }))
  })
  await page.reload()
  await page.locator('.tl-entry').waitFor()

  const localRefresh = await page.evaluate(async () => {
    const { useNotesStore } = await import('/src/stores/notes.ts')
    const store = useNotesStore()
    const pending = store.refreshActive()
    await new Promise(resolve => requestAnimationFrame(resolve))
    const painted = Boolean(document.querySelector('.tl-skeleton'))
    await pending
    return { painted, loading: store.activeLoading, count: store.activeNotes.length }
  })
  assert.deepEqual(localRefresh, { painted: true, loading: false, count: 1 })

  // Slow only the read action so loading is inspectable without adding production delays.
  await page.evaluate(async () => {
    const { useNotesStore } = await import('/src/stores/notes.ts')
    const store = useNotesStore()
    const selectDay = store.selectDay.bind(store)
    store.selectDay = async day => {
      await new Promise(resolve => setTimeout(resolve, 600))
      await selectDay(day)
    }
  })

  const skeleton = page.locator('.tl-skeleton')
  async function checkRefresh(count, screenshot) {
    await skeleton.waitFor({ state: 'visible' }).catch(async error => {
      await page.screenshot({ path: `${output}/loading-failure.png` })
      console.log(page.url(), (await page.locator('body').innerText()).slice(0, 1000))
      throw error
    })
    assert.equal(await page.locator('.tl-entry').count(), 0, 'old list stays hidden while refreshing')
    if (screenshot) await page.screenshot({ path: `${output}/${screenshot}.png` })
    await skeleton.waitFor({ state: 'detached' })
    assert.equal(await page.locator('.tl-entry').count(), count)
  }

  await page.locator('[aria-label="写一条新笔记"]').click()
  await page.locator('.ql-editor').fill('新增后的刷新状态')
  await page.locator('.editor-nav-btn--save').click()
  await checkRefresh(2, 'list-loading-after-create')

  assert.equal(await page.locator('.tl-entry__more, .swipe__delete').count(), 0)
  await page.locator('.tl-card__open').first().click()
  await page.locator('.ql-editor').fill('编辑后的刷新状态')
  await page.locator('.editor-nav-btn--save').click()
  await checkRefresh(2)
  assert((await page.locator('.tl-card__rich').first().innerText()).includes('编辑后的刷新状态'))

  await page.locator('.tl-card__open').first().click()
  await page.locator('.editor-delete').click()
  await page.locator('.note-action-sheet__row--danger').click()
  await checkRefresh(1)

  // A failed refresh must release loading and keep the previously loaded list usable.
  await page.evaluate(async () => {
    const { useNotesStore } = await import('/src/stores/notes.ts')
    const store = useNotesStore()
    const selectDay = store.selectDay.bind(store)
    store.selectDay = async day => {
      store.selectDay = selectDay
      await new Promise(resolve => setTimeout(resolve, 600))
      throw new Error('刷新失败测试')
    }
  })
  await page.locator('[aria-label="刷新记录"]').click()
  await checkRefresh(1)
  assert.equal(await page.evaluate(async () => {
    const { useNotesStore } = await import('/src/stores/notes.ts')
    return useNotesStore().refreshing
  }), false)
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 393)
  assert.deepEqual(errors, [])
  console.log('Passed: skeleton after create, edit, confirmed delete and failed refresh')
  await context.close()
} finally {
  await browser.close()
}
