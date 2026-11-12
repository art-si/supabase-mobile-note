import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const installedChrome = join(process.env.ProgramFiles || '', 'Google/Chrome/Application/chrome.exe')
const browser = await chromium.launch({ headless: true, executablePath: process.env.NOTE_BROWSER_EXECUTABLE || (existsSync(installedChrome) ? installedChrome : undefined) })
const base = process.env.NOTE_REVIEW_URL || 'http://localhost:5174'
const output = 'artifacts/mobile-review'
mkdirSync(output, { recursive: true })
const devices = [
  { name: 'small-phone', width: 320, height: 640, top: 24, bottom: 48, left: 0, right: 0 },
  { name: 'portrait', width: 393, height: 852, top: 32, bottom: 48, left: 0, right: 0 },
  { name: 'landscape', width: 852, height: 393, top: 0, bottom: 24, left: 44, right: 28 }
]
try {
  for (const device of devices) {
    const context = await browser.newContext({ viewport: device, isMobile: true, hasTouch: true, reducedMotion: 'reduce' })
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    page.setDefaultTimeout(8000)
    await page.goto(`${base}/#/pages/timeline/index`, { waitUntil: 'networkidle' })
    await page.locator('.tl-strip').waitFor()
    await page.evaluate(({ top, bottom, left, right }) => {
      for (const [edge, value] of Object.entries({ top, bottom, left, right })) document.documentElement.style.setProperty(`--safe-area-inset-${edge}`, `${value}px`)
    }, device)
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    const checkBars = async () => {
      const box = await page.locator('.note-tabbar__compose').boundingBox()
      assert(box && box.y + box.height <= device.height - device.bottom, `${device.name}: compose overlaps system navigation`)
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), device.width, `${device.name}: horizontal overflow`)
    }
    await checkBars()
    const today = await page.locator('.tl-strip__day--today').boundingBox()
    assert(today && today.x >= device.left && today.x + today.width <= device.width - device.right, `${device.name}: today is outside date strip on initial load`)
    const navControls = await page.locator('.tl-nav .tl-icon-btn').evaluateAll(els => els.map(el => el.getBoundingClientRect().toJSON()))
    assert(navControls.length === 3 && navControls.every(b => b.y >= device.top && b.x >= device.left && b.right <= device.width - device.right), `${device.name}: timeline header overlaps system bars`)
    await page.screenshot({ path: `${output}/${device.name}-timeline.png` })
    await page.locator('[aria-label="写一条新笔记"]').tap()
    await page.locator('.editor-toolbar').waitFor()
    await page.locator('[aria-label="修改笔记日期和时间"]').tap()
    await page.locator('.note-sheet__panel').waitFor()
    await page.screenshot({ path: `${output}/${device.name}-date.png` })
    await page.locator('[aria-label="关闭面板"]').tap()
    await page.locator('.note-sheet__panel').waitFor({ state: 'detached' })
    // Wot's semantic button listens to click; this also checks the reported back action.
    await page.locator('[aria-label="取消编辑"]').click()
    await page.locator('.tl-strip').waitFor()
    await page.locator('[aria-label="我的"]').tap()
    await page.locator('.mine-appearance').waitFor()
    await checkBars()
    const options = await page.locator('.mine-appearance__option').evaluateAll(els => els.map(el => el.getBoundingClientRect().toJSON()))
    assert(options.length === 3 && options.every(b => b.height >= 44 && b.y === options[0].y), `${device.name}: appearance controls are misaligned`)
    await page.screenshot({ path: `${output}/${device.name}-mine.png`, fullPage: true })
    await page.locator('.mine-about').scrollIntoViewIfNeeded()
    await page.screenshot({ path: `${output}/${device.name}-mine-bottom.png` })
    assert.deepEqual(errors, [], `${device.name}: runtime errors`)
    console.log(`${device.name}: timeline, date picker, back navigation and settings passed`)
    await context.close()
  }
} finally {
  await browser.close()
}
