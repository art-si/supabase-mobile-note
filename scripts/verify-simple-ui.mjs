import assert from 'node:assert/strict'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright'

const base = process.env.NOTE_REVIEW_URL || 'http://localhost:5174'
const chrome = join(process.env.ProgramFiles || '', 'Google/Chrome/Application/chrome.exe')
const browser = await chromium.launch({ headless: true, executablePath: process.env.NOTE_BROWSER_EXECUTABLE || (existsSync(chrome) ? chrome : undefined) })
const output = 'artifacts/simple-review'
mkdirSync(output, { recursive: true })
const city = { id: 1, name: '杭州', admin1: '浙江', country: '中国', latitude: 30.27, longitude: 120.15 }

try {
  const context = await browser.newContext({ viewport: { width: 393, height: 852 }, reducedMotion: 'reduce' })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  page.setDefaultTimeout(8000)
  let allowCloudConfig
  const cloudConfigGate = new Promise(resolve => { allowCloudConfig = resolve })
  await page.route('**/rest/v1/rpc/get_note_cloud_access', async route => {
    await cloudConfigGate
    await route.fulfill({ json: 'closed' })
  })
  await page.route('https://geocoding-api.open-meteo.com/**', route => route.fulfill({ json: { results: [city] } }))
  let weatherFails = false
  let weatherCode = 0
  await page.route('https://api.open-meteo.com/**', route => weatherFails ? route.abort() : route.fulfill({ json: {
    current: { temperature_2m: 18.5, weather_code: weatherCode }, daily: { temperature_2m_min: [12], temperature_2m_max: [21] }
  } }))
  await page.goto(`${base}/#/pages/timeline/index`)
  await page.locator('.tl-strip').waitFor()
  await page.locator('.note-empty').waitFor({ timeout: 3500 })
  await page.locator('[aria-label="写一条新笔记"]').click()
  await page.locator('.editor-quick-start').waitFor({ timeout: 3500 })
  allowCloudConfig()
  await page.locator('[aria-label="取消编辑"]').click()
  await page.locator('.tl-strip').waitFor()
  assert.equal(await page.locator('.tl-entry__more').count(), 0)
  assert.equal(await page.locator('.tl-hero__year').count(), 0)
  assert.equal(await page.locator('.tl-hero__mark').count(), 0)
  const weatherTrigger = page.locator('.weather-trigger')
  assert((await weatherTrigger.getAttribute('aria-label')).includes('当前位置'))
  await weatherTrigger.click()
  await page.locator('.weather-error').filter({ hasText: '未开启定位' }).waitFor()
  assert.equal(await page.locator('.weather-search input').count(), 0, 'manual city choice stays secondary')
  await context.grantPermissions(['geolocation'])
  await context.setGeolocation({ latitude: city.latitude, longitude: city.longitude })
  await page.locator('.weather-refresh').click()
  await page.waitForFunction(() => document.querySelector('.weather-trigger__label')?.textContent === '晴 · 19°C')
  assert.equal(await page.locator('.weather-city').first().innerText(), '当前位置')
  await page.locator('.weather-manual-toggle').click()
  await page.locator('.weather-search input').fill('杭州')
  await page.locator('.weather-search .note-btn').click()
  await page.locator('.weather-result').click()
  await page.waitForFunction(() => document.querySelector('.weather-trigger__label')?.textContent === '晴 · 19°C')
  weatherCode = 3
  await page.locator('.weather-refresh').click()
  await page.waitForFunction(() => document.querySelector('.weather-trigger__label')?.textContent === '阴 · 19°C')
  weatherFails = true
  await page.locator('.weather-refresh').click()
  await page.locator('.weather-error').waitFor()
  assert((await page.locator('.weather-temperature').innerText()).includes('19°C'), 'offline keeps cached temperature')
  await page.locator('[aria-label="关闭面板"]').click()
  await page.locator('.note-sheet__panel').waitFor({ state: 'detached' })

  // A historical day still shows clearly labelled current weather until the large date scrolls out.
  await page.evaluate(() => {
    const date = new Date()
    date.setDate(date.getDate() - 1)
    date.setHours(12, 0, 0, 0)
    const createdAt = date.toISOString()
    uni.setStorageSync('note-local-entries', Array.from({ length: 16 }, (_, index) => ({
      id: `scroll-${index}`, content: `历史记录 ${index + 1}`, contentText: `历史记录 ${index + 1}`,
      createdAt, updatedAt: createdAt, userId: 'local-device', tags: ['喝水'], images: [], mood: 'calm'
    })))
  })
  await page.reload()
  const previousDay = page.locator('.tl-strip__day--today').locator('xpath=preceding-sibling::*[1]')
  await previousDay.click()
  await page.locator('.tl-card__open').first().waitFor()
  const selectedDate = await page.locator('.tl-hero__title').innerText()
  assert((await page.locator('.weather-trigger').innerText()).includes('今日'))
  assert((await page.locator('.weather-trigger').innerText()).includes('阴 · 19°C'))
  await page.screenshot({ path: `${output}/timeline-weather.png` })
  await page.evaluate(() => window.scrollTo(0, 400))
  await page.locator('.tl-nav__title').getByText(selectedDate, { exact: true }).waitFor()
  assert.equal(await page.locator('.weather-trigger').count(), 0)
  await page.screenshot({ path: `${output}/timeline-scrolled.png` })
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.locator('.weather-trigger').waitFor()

  await page.locator('[aria-label="写一条新笔记"]').click()
  await page.locator('.editor-quick-start uni-button').first().click()
  assert((await page.locator('.ql-editor').innerText()).includes('喂奶：'))
  await page.locator('.ql-editor').fill('测试可恢复的文字草稿')
  await page.getByText('文字草稿已保存在本机', { exact: true }).waitFor()
  await page.locator('[aria-label="取消编辑"]').click()
  await page.locator('.note-action-sheet__row').filter({ hasText: '保留草稿并退出' }).click()
  await page.locator('.tl-strip').waitFor()
  await page.locator('[aria-label="写一条新笔记"]').click()
  await page.getByText('已恢复上次未完成的文字', { exact: true }).waitFor()
  await page.locator('.ql-editor').getByText('测试可恢复的文字草稿', { exact: true }).waitFor()

  const dateBefore = await page.locator('.editor-date-title').innerText()
  await page.locator('.editor-date-title').click()
  await page.locator('.cal__cell--selected').waitFor()
  await page.locator('.cal__cell').filter({ hasText: /^10$/ }).first().click()
  await page.locator('[aria-label="关闭面板"]').click()
  await page.locator('.note-sheet__panel').waitFor({ state: 'detached' })
  assert.equal(await page.locator('.editor-date-title').innerText(), dateBefore, 'dismissed date changes are discarded')
  await page.locator('.editor-date-title').click()
  await page.locator('.cal__cell').filter({ hasText: /^10$/ }).first().click()
  await page.locator('.cal__actions .note-btn--primary').click()
  assert((await page.locator('.editor-date-title').innerText()).includes('月10日'))
  await page.locator('[aria-label="常用短语"]').click()
  await page.locator('[aria-label="新增常用短语"] input').fill('散步：')
  await page.locator('.editor-tag-entry .wd-button').click()
  await page.locator('.editor-phrase-insert').filter({ hasText: '散步：' }).waitFor()
  await page.locator('[aria-label="关闭面板"]').click()
  await page.locator('.note-sheet__panel').waitFor({ state: 'detached' })
  await page.screenshot({ path: `${output}/editor.png` })
  await page.locator('.editor-nav-btn--save').click()
  await page.locator('.tl-strip').waitFor()
  assert.equal(await page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('note-text-draft')).length), 0)

  await page.locator('[id$="-10"].tl-strip__day').click()
  await page.locator('.tl-card__open').filter({ hasText: '测试可恢复的文字草稿' }).waitFor()
  await page.locator('[aria-label="搜索笔记"]').click()
  await page.locator('.tl-searchbar input').fill('可恢复')
  await page.locator('.tl-filter').getByText('关键词「可恢复」').waitFor()
  await page.locator('.tl-card__open').filter({ hasText: '测试可恢复的文字草稿' }).waitFor()
  await page.locator('.tl-searchbar__cancel').click()
  assert((await page.locator('.tl-hero__title').innerText()).includes('月10日'), 'cancel restores selected date')

  await page.locator('[aria-label="设置"]').click()
  await page.locator('.mine-appearance').waitFor()
  assert.equal(await page.locator('.mine-profile, .mine-stats, .mine-account').count(), 0)
  await page.screenshot({ path: `${output}/settings.png`, fullPage: true })
  await page.getByText('深色', { exact: true }).click()
  await page.screenshot({ path: `${output}/settings-dark.png`, fullPage: true })
  await page.getByText('浅色', { exact: true }).click()
  await page.locator('[aria-label="时间轴"]').click()
  await page.locator('.tl-strip').waitFor()
  await page.locator('[aria-label="写一条新笔记"]').click()
  const addedPhrase = page.locator('.editor-quick-start').getByText('散步：', { exact: true })
  await addedPhrase.waitFor()
  await page.screenshot({ path: `${output}/editor-empty.png` })
  await addedPhrase.click()
  assert((await page.locator('.ql-editor').innerText()).includes('散步：'))
  await page.locator('[aria-label="整理标签"]').click()
  await page.locator('.editor-suggestion').first().click()
  const tag = page.locator('.editor-tags--panel .note-tag').first()
  await tag.waitFor()
  const remove = tag.locator('.note-tag__remove')
  const target = await remove.boundingBox()
  assert(target && target.width >= 44 && target.height >= 44, 'tag removal has a full touch target')
  await page.screenshot({ path: `${output}/tags.png` })
  await remove.click()
  await tag.waitFor({ state: 'detached' })
  await page.locator('.editor-suggestion').first().click()
  await page.locator('.editor-sheet__done').click()
  const editorTag = page.locator('.editor-tags .note-tag').first()
  assert.match(await editorTag.evaluate(el => getComputedStyle(el).display), /^(inline-)?flex$/)
  const label = await editorTag.locator('.note-tag__label').boundingBox()
  const removeTarget = await editorTag.locator('.note-tag__remove').boundingBox()
  assert(label && removeTarget && label.x + label.width <= removeTarget.x && label.y < removeTarget.y + removeTarget.height, 'editor tag and remove button align horizontally')
  await page.screenshot({ path: `${output}/editor-tags.png` })
  assert.deepEqual(errors, [])
  await context.close()

  // Exercise real authentication/import orchestration against isolated fake endpoints.
  const cloud = await browser.newContext({ viewport: { width: 393, height: 852 }, reducedMotion: 'reduce' })
  const login = await cloud.newPage()
  login.setDefaultTimeout(10000)
  const avatarUrl = 'https://avatar.example.test/review.png'
  const profileAvatarUrl = 'https://avatar.example.test/profile.png'
  let failAvatar = false
  await login.route(profileAvatarUrl, route => failAvatar
    ? route.fulfill({ status: 404 })
    : route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><rect width="48" height="48" fill="#007f90"/><circle cx="24" cy="24" r="12" fill="#fff"/></svg>' }))
  await login.route('**/rest/v1/sys_user?*', route => {
    const params = new URL(route.request().url()).searchParams
    assert.equal(params.get('auth_user_id'), 'eq.review-user', 'profile requests stay scoped to the signed-in account')
    return route.fulfill({ json: [{ avatar: profileAvatarUrl, nick_name: '时光', user_name: 'review' }] })
  })
  await login.route('**/rest/v1/rpc/get_note_cloud_access', route => route.fulfill({
    json: route.request().headers().authorization === 'Bearer test-token' ? 'allowed' : 'login'
  }))
  let authCalls = 0
  let imageUploads = 0
  const imported = []
  let nextCloudId = 0
  let noteWrites = 0
  let failSecond = true
  await login.route('**/functions/v1/driver-auth', async route => {
    authCalls++
    await route.fulfill({ json: { access_token: 'test-token', refresh_token: 'test-refresh', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: 'review-user', email: 'review@example.test', user_metadata: { name: '时光', avatar_url: avatarUrl } } } })
  })
  await login.route('**/storage/v1/object/note-images/**', async route => {
    imageUploads++
    await new Promise(resolve => setTimeout(resolve, 500))
    await route.fulfill({ json: { Key: 'test-image' } })
  })
  await login.route('**/storage/v1/object/sign/**', route => route.fulfill({ json: [] }))
  await login.route('**/rest/v1/notes*', async route => {
    if (route.request().method() !== 'POST') { await route.fulfill({ json: imported }); return }
    const data = route.request().postDataJSON()
    await new Promise(resolve => setTimeout(resolve, 500))
    if (data.content === '记录二' && failSecond) {
      failSecond = false
      await route.fulfill({ status: 503, json: { message: '暂时无法保存，请重试' } })
      return
    }
    noteWrites++
    const note = { ...data, id: `import-${nextCloudId++}`, content_text: data.content, user_id: 'review-user', updated_at: data.created_at }
    imported.push(note)
    await route.fulfill({ json: [note] })
  })
  await login.goto(base)
  await login.locator('.tl-strip').waitFor()
  const existingCreatedAt = await login.evaluate(async () => {
    const { saveLocalNoteImage } = await import('/src/api/localNoteImages.ts')
    const path = await saveLocalNoteImage('data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="blue"/></svg>'))
    uni.setStorageSync('note-storage-mode', 'cloud')
    uni.setStorageSync('note-pending-local-import', 'yes')
    const now = Date.now()
    uni.setStorageSync('note-local-entries', ['记录一', '记录二', '记录三'].map((content, index) => ({
      id: 'review-' + index, userId: 'local-device', content, contentText: content, mood: 'calm',
      images: index === 0 ? [path] : [], tags: [], createdAt: new Date(now - index * 60000).toISOString(), updatedAt: new Date(now).toISOString()
    })))
    // A legacy success marker must never hide missing cloud rows.
    uni.setStorageSync('note-imported-local-notes', JSON.stringify({ 'review-user': ['review-0', 'review-1', 'review-2'] }))
    return new Date(now - 120000).toISOString()
  })
  imported.push({ id: 'already-in-cloud', user_id: 'review-user', content: '记录三', content_text: '记录三',
    created_at: existingCreatedAt, updated_at: existingCreatedAt, mood: 'calm', images: [], tags: [] })
  await login.reload()
  await login.locator('.login-submit:not([disabled])').waitFor()
  await login.locator('.login-submit').click()
  await login.getByText('请输入邮箱或手机号', { exact: true }).waitFor()
  await login.locator('[aria-label="邮箱或手机号"] input').fill('review@example.test')
  await login.locator('[aria-label="密码"] input').fill('test-password')
  await login.waitForFunction(() => {
    const mark = document.querySelector('.login-mark img')
    return mark?.naturalWidth > 0
  })
  await login.screenshot({ path: `${output}/login.png` })
  await login.locator('.login-submit').click()
  await login.getByText('已登录，正在导入本机记录', { exact: true }).waitFor()
  await login.getByText(/图片 1\/1 · 上传/).waitFor()
  await login.screenshot({ path: `${output}/import-progress.png` })
  await login.getByText('导入已暂停', { exact: true }).waitFor()
  assert((await login.locator('.login-import__detail').innerText()).includes('1 / 3'))
  await login.locator('.login-submit').click()
  await login.locator('.tl-strip').waitFor()
  assert.equal(authCalls, 1, 'resuming import reuses the valid session')
  assert.equal(imageUploads, 1, 'completed record/image is skipped when resuming')
  assert.deepEqual(imported.map(note => note.content).sort(), ['记录一', '记录二', '记录三'].sort())
  assert.equal(noteWrites, 2, 'legacy markers are checked against actual cloud records')
  assert.equal(await login.evaluate(() => uni.getStorageSync('note-local-entries').length), 3)
  await login.locator('[aria-label="设置"]').click()
  await login.locator('.mine-account__value').getByText('review@example.test').waitFor()
  await login.waitForFunction(() => document.querySelector('.mine-account__avatar img')?.naturalWidth > 0)
  assert.equal(await login.locator('.mine-account__avatar img').getAttribute('src'), profileAvatarUrl)
  await login.locator('[aria-label="查看头像大图"]').click()
  await login.locator('#u-a-p img').waitFor()
  assert.equal(await login.locator('#u-a-p img').getAttribute('src'), profileAvatarUrl)
  await login.screenshot({ path: `${output}/avatar-preview.png` })
  await login.keyboard.press('Escape')
  await login.locator('#u-a-p img').waitFor({ state: 'detached' })
  const account = await login.locator('.mine-account').boundingBox()
  const navbar = await login.locator('.note-navbar').boundingBox()
  assert(account && navbar && account.y - navbar.y - navbar.height >= 15, 'account card has room below the header')
  await login.screenshot({ path: `${output}/settings-cloud.png` })
  await login.locator('.mine-import').filter({ hasText: '导入本机记录' }).click()
  await login.locator('.tl-strip').waitFor()
  await login.getByText('已核对，3 条记录均已在云端', { exact: true }).waitFor()
  assert.equal(noteWrites, 2, 'repeated import does not create duplicates')
  imported.splice(imported.findIndex(note => note.content === '记录二'), 1)
  await login.locator('[aria-label="设置"]').click()
  await login.locator('.mine-import').filter({ hasText: '导入本机记录' }).click()
  await login.locator('.tl-strip').waitFor()
  await login.getByText('已新增 1 条，云端已有 2 条', { exact: true }).waitFor()
  assert.equal(imported.length, 3, 'missing cloud rows are restored even after a recorded success')
  assert.equal(noteWrites, 3)
  assert.equal(authCalls, 1)
  assert.equal(imageUploads, 1)
  await login.locator('[aria-label="设置"]').click()
  failAvatar = true
  await login.reload()
  await login.locator('.mine-account__avatar').getByText('时', { exact: true }).waitFor()
  await login.screenshot({ path: `${output}/settings-cloud-fallback.png` })
  await cloud.close()
  console.log('Passed: settings and cloud avatar, brand icon, weather/cache, shortcuts and tags, draft recovery, date confirmation, login/import progress and resume')
} finally {
  await browser.close()
}
