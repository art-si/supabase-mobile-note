const TAG_PATTERN = /<[a-z][^>]*>/i

export function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function isRichHtml(content: string) {
  return TAG_PATTERN.test(content)
}

// 旧版纯文本笔记：转义后保留换行，升级为 HTML 渲染。
export function legacyToHtml(content: string) {
  return escapeHtml(content).replace(/\n/g, '<br>')
}

// rich-text 在小程序端无法命中页面样式，内联样式保证双端排版一致。
const TAG_STYLES: Record<string, string> = {
  p: 'margin:0 0 8px;',
  h1: 'font-size:1.4em;font-weight:700;margin:12px 0 8px;',
  h2: 'font-size:1.25em;font-weight:700;margin:10px 0 8px;',
  h3: 'font-size:1.1em;font-weight:600;margin:8px 0;',
  blockquote:
    'margin:8px 0;padding:4px 12px;border-left:3px solid rgba(120,120,128,0.35);opacity:0.85;',
  ul: 'margin:4px 0;padding-left:22px;list-style:disc;',
  ol: 'margin:4px 0;padding-left:22px;list-style:decimal;',
  li: 'margin:2px 0;',
  a: 'color:#0a84ff;text-decoration:underline;',
  pre: 'white-space:pre-wrap;background:rgba(120,120,128,0.12);padding:8px 12px;border-radius:8px;',
  img: 'max-width:100%;border-radius:8px;'
}

export function decorateRichHtml(html: string) {
  return html.replace(/<([a-z0-9]+)((?:\s[^>]*)?)>/gi, (match, tag: string, attrs: string) => {
    const style = TAG_STYLES[tag.toLowerCase()]
    if (!style || /style\s*=/i.test(attrs)) return match
    return `<${tag}${attrs} style="${style}">`
  })
}

export function renderNoteHtml(content: string) {
  return decorateRichHtml(isRichHtml(content) ? content : legacyToHtml(content))
}

export function editorInitialHtml(content: string) {
  return isRichHtml(content) ? content : legacyToHtml(content)
}

export function htmlToPlainText(html: string) {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|blockquote)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .trim()
}