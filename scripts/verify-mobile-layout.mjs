import assert from 'node:assert/strict'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright'

// Run against the dev server: node scripts/verify-mobile-layout.mjs
const base = process.env.NOTE_REVIEW_URL || 'http://localhost:5174'
const installedChrome = join(process.env.ProgramFiles || '', 'Google/Chrome/Application/chrome.exe')
const executablePath = process.env.NOTE_BROWSER_EXECUTABLE || (existsSync(installedChrome) ? installedChrome : undefined)
const browser = await chromium.launch({ headless: true, executablePath })
const output = 'artifacts/mobile-review'
mkdirSync(output, { recursive: true })
const cases = [
  { name: 'portrait-three-button', width: 375, height: 812, top: 32, bottom: 48, left: 0, right: 0 },
  { name: 'small-phone', width: 320, height: 640, top: 24, bottom: 24, left: 0, right: 0 },
  { name: 'landscape-dark', width: 852, height: 393, top: 0, bottom: 24, left: 44, right: 28, dark: true },
  { name: 'large-text', width: 393, height: 852, top: 32, bottom: 24, left: 0, right: 0, largeText: true }
]
try {
  for (const device of cases) {
    const context = await browser.newContext({
      viewport: { width: device.width, height: device.height },
      isMobile: true, hasTouch: true,
      colorScheme: device.dark ? 'dark' : 'light', reducedMotion: 'reduce'
    })
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    page.setDefaultTimeout(8000)
    await page.goto(`${base}/#/pages/editor/index`, { waitUntil: 'networkidle' })
    await page.locator('.editor-toolbar').waitFor()
    await page.evaluate(({ top, bottom, left, right, largeText }) => {
      const root = document.documentElement.style
      for (const [edge, value] of Object.entries({ top, bottom, left, right })) {
        root.setProperty(`--safe-area-inset-${edge}`, `${value}px`)
      }
      if (largeText) {
        const style = document.createElement('style')
        style.textContent = '.page { --note-font-body:24px; --note-font-subhead:21px; --note-font-footnote:18px; --note-font-caption:16px; }'
        document.head.append(style)
      }
    }, device)
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    const bounds = await page.evaluate(() => {
      const box = selector => document.querySelector(selector).getBoundingClientRect().toJSON()
      return { title: box('.editor-date-title'), toolbar: box('.editor-toolbar'), body: box('.editor-paper'), width: document.documentElement.scrollWidth }
    })
    await page.screenshot({ path: `${output}/${device.name}-editor.png` })
    assert(bounds.title.y >= device.top, `${device.name}: title overlaps status bar: ${JSON.stringify(bounds)}`)
    assert(bounds.toolbar.x >= device.left, `${device.name}: toolbar overlaps left cutout`)
    assert(bounds.toolbar.right <= device.width - device.right, `${device.name}: toolbar overlaps right cutout`)
    assert(bounds.width <= device.width, `${device.name}: horizontal page overflow`)
    assert(bounds.body.y >= bounds.title.bottom, `${device.name}: editor starts behind navbar`)
    const tools = await page.locator('.editor-toolbar .editor-tool').evaluateAll(elements => elements.map(el => el.getBoundingClientRect().toJSON()))
    assert(tools.length >= 4, `${device.name}: toolbar controls did not render`)
    assert(tools.every(box => box.bottom <= device.height - device.bottom + 1), `${device.name}: controls overlap system navigation`)
    await page.locator('[aria-label="整理标签"]').tap()
    await page.locator('.note-sheet__panel').waitFor()
    await page.locator('.editor-suggestion').first().tap()
    const footer = await page.locator('.note-sheet__footer .note-btn').boundingBox()
    assert(footer && footer.y + footer.height <= device.height - device.bottom + 1, `${device.name}: sheet footer overlaps system navigation`)
    await page.screenshot({ path: `${output}/${device.name}-tags.png` })
    await page.locator('[aria-label="关闭面板"]').tap()
    await page.locator('.note-sheet__panel').waitFor({ state: 'detached' })
    assert.equal(await page.evaluate(() => document.body.style.overflow), '', `${device.name}: sheet leaves scroll locked`)
    assert.deepEqual(errors, [], `${device.name}: browser runtime errors`)
    console.log(`${device.name}: layout and tag sheet passed`)
    await context.close()
  }
  const context = await browser.newContext({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true, reducedMotion: 'no-preference' })
  const page = await context.newPage()
  await page.goto(`${base}/#/pages/editor/index`, { waitUntil: 'networkidle' })
  await page.locator('[aria-label="整理标签"]').tap()
  // Interrupt a moving sheet, cancel the gesture, then dismiss it with a full drag.
  await page.waitForFunction(() => {
    const panel = document.querySelector('.note-sheet__panel')
    return panel && new DOMMatrix(getComputedStyle(panel).transform).m42 > 20
  })
  const grip = page.locator('.note-sheet__grip')
  const touch = (kind, y) => grip.evaluate((el, { kind, y }) => {
    const point = new Touch({ identifier: 1, target: el, clientX: 196, clientY: y })
    el.dispatchEvent(new TouchEvent(kind, { bubbles: true, cancelable: true, touches: kind === 'touchstart' || kind === 'touchmove' ? [point] : [], changedTouches: [point] }))
  }, { kind, y })
  await touch('touchstart', 600)
  const before = await page.locator('.note-sheet__panel').evaluate(el => new DOMMatrix(getComputedStyle(el).transform).m42)
  await touch('touchmove', 620)
  const after = await page.locator('.note-sheet__panel').evaluate(el => new DOMMatrix(getComputedStyle(el).transform).m42)
  assert(Math.abs(after - before - 20) < 2, 'moving sheet does not follow the finger from its current position')
  await touch('touchcancel', 620)
  await page.waitForFunction(() => {
    const panel = document.querySelector('.note-sheet__panel')
    return panel && Math.abs(new DOMMatrix(getComputedStyle(panel).transform).m42) < 0.5
  })
  await touch('touchstart', 400)
  await touch('touchmove', 700)
  await touch('touchend', 700)
  await page.locator('.note-sheet__panel').waitFor({ state: 'detached' })
  assert.equal(await page.evaluate(() => document.body.style.overflow), '', 'drag dismissal leaves scroll locked')
  console.log('sheet motion: interrupted drag, touch cancellation and dismissal passed')
  await context.close()
} finally {
  await browser.close()
}
