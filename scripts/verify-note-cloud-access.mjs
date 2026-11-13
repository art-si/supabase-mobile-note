import assert from 'node:assert/strict'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright'

const chrome = join(process.env.ProgramFiles || '', 'Google/Chrome/Application/chrome.exe')
const browser = await chromium.launch({ headless: true, executablePath: existsSync(chrome) ? chrome : undefined })
const base = process.env.NOTE_REVIEW_URL || 'http://localhost:5174'
const output = '.artifacts/note-cloud-ui'
mkdirSync(output, { recursive: true })
try {
  for (const width of [393, 320]) {
    const context = await browser.newContext({ viewport: { width, height: 852 } })
    const page = await context.newPage()
    page.setDefaultTimeout(15_000)
    let access = 'denied'
    let noteRequests = 0
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.route('**/rest/v1/rpc/get_note_cloud_access', route => {
      const result = route.request().headers().authorization === 'Bearer fixture-token' ? access : 'login'
      return route.fulfill({ json: result })
    })
    await page.route('**/functions/v1/driver-auth', route => route.fulfill({ json: {
      access_token: 'fixture-token', refresh_token: 'fixture-refresh',
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: { id: 'fixture-user', email: 'fixture@example.invalid' }
    } }))
    await page.route('**/rest/v1/notes?*', route => {
      if (access === 'denied') return route.fulfill({ status: 403, json: { message: '云端访问未授权' } })
      noteRequests++
      return route.fulfill({ json: [] })
    })
    await page.addInitScript(() => {
      if (!localStorage.getItem('note-storage-mode'))
        localStorage.setItem('note-storage-mode', JSON.stringify({ type: 'string', data: 'cloud' }))
    })
    await page.goto(base + '/#/pages/login/index')
    await page.locator('[aria-label="邮箱或手机号"] input').fill('fixture@example.invalid')
    await page.locator('[aria-label="密码"] input').fill('fixture-password')
    await page.locator('.login-submit').click()
    await page.getByText(/当前账号未获云端存储授权/).waitFor()
    assert.equal(noteRequests, 0, 'denied login must not read or import notes')
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    await page.screenshot({ path: output + '/denied-' + width + '.png', fullPage: true })

    access = 'allowed'
    const loadedNotes = page.waitForResponse(response =>
      response.url().includes('/rest/v1/notes?') && response.status() === 200)
    await page.locator('.login-submit').click()
    await page.locator('.tl-strip').waitFor()
    await loadedNotes
    assert(noteRequests > 0, 'allowed login should load timeline')
    access = 'denied'
    const previousRequests = noteRequests
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.getByText('云端存储不可用', { exact: true }).waitFor()
    await page.waitForLoadState('networkidle')
    assert.equal(noteRequests, previousRequests, 'revoked account must not access notes')
    assert.equal(await page.evaluate(() =>
      JSON.parse(localStorage.getItem('note-storage-mode')).data), 'cloud',
    'revocation must preserve the selected storage mode')
    await page.screenshot({ path: output + '/revoked-' + width + '.png', fullPage: true })
    access = 'allowed'
    const recoveredNotes = page.waitForResponse(response =>
      response.url().includes('/rest/v1/notes?') && response.status() === 200)
    const retry = page.getByRole('button', { name: '重新检查授权', exact: true })
    if (width === 320) await retry.focus()
    await Promise.all([
      recoveredNotes,
      width === 320 ? retry.press('Enter') : retry.click()
    ])
    assert(noteRequests > previousRequests, 'regranted account should recover without losing the session')
    await page.getByText('云端存储不可用', { exact: true }).waitFor({ state: 'hidden' })
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    await page.screenshot({ path: output + '/regranted-' + width + '.png', fullPage: true })
    assert.deepEqual(errors, [])
    await context.close()
  }
  console.log('Passed at 393px and 320px: denied login, allowed access, revoked session, regranted access')
} finally {
  await browser.close()
}
