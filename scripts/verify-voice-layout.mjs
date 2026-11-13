import {mkdirSync} from 'node:fs'
mkdirSync('artifacts/voice-layout-review',{recursive:true})
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'})
try {
 const page=await browser.newPage({viewport:{width:393,height:852}})
 await page.goto('http://localhost:5174')
 let uploads=0
 await page.route('**/functions/v1/note-transcribe',route=>{uploads++;return route.fulfill({json:{text:'云端转写测试'}})})

 await page.evaluate(async()=>{
  const code=await fetch("/src/components/common/NoteVoiceInput.vue").then(r=>r.text());await import(code.match(/from "([^"]*capacitor[^"]+)"/)[1]);let resolve, reject
  window.voiceTexts=[]
  window.Capacitor.registerPlugin('NoteSpeech',{web:()=>({start:async()=>{},stop:async()=>({data:btoa('test audio'),mimeType:'audio/wav'}),cancel:async()=>{}})})
  const {createApp,h}=await import((await fetch('/src/components/common/NoteVoiceInput.vue').then(r=>r.text())).match(/from "([^"]*uni-h5-vue[^"]+)"/)[1])
  const Voice=(await import('/src/components/common/NoteVoiceInput.vue')).default
  const authCode=await fetch('/src/stores/auth.ts').then(r=>r.text())
  const {createPinia}=await import(authCode.match(/from "([^"]*pinia[^"]+)"/)[1])
  const pinia=createPinia()
  const auth=(await import('/src/stores/auth.ts')).useAuthStore(pinia)
  ;(await import('/src/utils/storageMode.ts')).persistStorageMode('cloud')
  let refreshed=0
  auth.refreshSession=async()=>{refreshed++}
  auth.booted=true
  const now=Date.now
  const exp=Math.floor(now()/1000)+3600
  auth.session={access_token:`e30.${btoa(JSON.stringify({exp}))}.signature`,expires_at:exp+10000,user:{id:'test'}}
  try {
   await auth.ensureValidSession()
   if(refreshed)throw Error('Valid JWT unexpectedly refreshed')
   Date.now=()=>now()+4000*1000
   await auth.ensureValidSession()
   if(refreshed!==1)throw Error('JWT expiry must be checked on every request, regardless of cached metadata')
  } finally {Date.now=now}
  auth.session={access_token:'voice-test-token',user:{id:'voice-test-user'}}
  auth.cloudAccessGranted=true
  auth.ensureValidSession=async()=>true
  auth.requireCloudAccess=async()=>{}
  const storage=(await import('/src/stores/storageMode.ts')).useStorageModeStore(pinia)
  storage.mode='cloud'
  ;(await import('/src/utils/storageMode.ts')).persistStorageMode('cloud')
  const host=document.createElement('div');host.style.cssText='position:fixed;top:100px;left:20px;z-index:100;width:350px';document.body.append(host)
  createApp({render:()=>h(Voice,{onText:text=>window.voiceTexts.push(text)})}).use(pinia).mount(host)
 })
 await page.locator('.voice-icon').click()
 const hold=page.locator('[aria-label="按住说话"]')
 await hold.dispatchEvent('touchstart',{touches:[{identifier:1,clientX:100,clientY:300}]})
 assert.equal(await page.evaluate(()=>window.voiceTexts.length),0)
 assert.equal(uploads,0)
 await hold.dispatchEvent('touchend',{touches:[]})
 await page.waitForFunction(()=>window.voiceTexts.length===1)
 assert.equal(uploads,1)
 await page.locator('.voice-icon').click()
 await hold.dispatchEvent('touchstart',{touches:[{identifier:1,clientX:100,clientY:300}]})
 await hold.dispatchEvent('touchmove',{touches:[{identifier:1,clientX:100,clientY:200}]})
 await hold.dispatchEvent('touchend',{touches:[]})
 assert.equal(await page.evaluate(()=>window.voiceTexts.length),1)
 assert.equal(uploads,1)
 console.log('PASS: release uploads audio to cloud; upward cancellation never uploads')
 await page.locator('.note-sheet__close').click()
 await page.evaluate(async()=>{
  const code=await fetch('/src/components/common/NoteVoiceInput.vue').then(r=>r.text())
  const {createApp,h}=await import(code.match(/from "([^"]*uni-h5-vue[^"]+)"/)[1])
  const Sheet=(await import('/src/components/common/NoteSheet.vue')).default
  const host=document.createElement('div');document.body.append(host)
  createApp({render:()=>h(Sheet,{show:true,title:'长内容小结验收'}, {
   default:()=>h('div',{style:'padding:16px 16px 28px'},Array.from({length:20},(_,i)=>h('div',{class:i===19?'last-summary':'',style:'height:100px;margin-bottom:12px;border:1px solid #ddd'},`第 ${i+1} 条小结`))),
   footer:()=>h('button',{class:'summary-done',style:'height:44px;width:100%'},'完成')
  })}).mount(host)
 })
 await page.getByText('长内容小结验收',{exact:true}).waitFor()
 await page.evaluate(()=>{const root=document.querySelector('.last-summary').closest('uni-scroll-view');for(const e of root.querySelectorAll('*'))if(e.scrollHeight>e.clientHeight&&e.clientHeight>100)e.scrollTop=e.scrollHeight})
 await page.waitForTimeout(200)
 const gap=await page.evaluate(()=>document.querySelector('.summary-done').getBoundingClientRect().top-document.querySelector('.last-summary').getBoundingClientRect().bottom)
 assert(gap>=24, `Summary footer clearance ${gap}`)
 await page.screenshot({path:'artifacts/voice-layout-review/long-summary.png'})
 console.log('PASS: long summary scrolls with footer clearance',gap)
} finally {await browser.close()}
