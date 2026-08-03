// ============================================================================
// 统一 JSON / XML 响应解码器
// ----------------------------------------------------------------------------
// TVBox 订阅与苹果 CMS 站点既可能返回带注释 / 尾逗号的容错 JSON,也可能返回
// XML(RSS 风格)响应。这里提供单一入口 decodeResponse:自动识别格式并把原始
// 文本翻译成普通对象,解析失败时给出可读的原因。
// ============================================================================

export type DecodedDocument = { kind: 'json' | 'xml'; data: unknown; raw: string }

// ---- 容错 JSON(TVBox 配置常带 // 注释与尾逗号) ------------------------------
function stripJsonComments(input: string): string {
  let out = ''
  let inStr = false
  let quote = ''
  for (let i = 0; i < input.length; i++) {
    const c = input[i]
    if (inStr) {
      // 字符串里的原始控制字符(\t \n \r 等)在严格 JSON 里非法 —— 换成空格。
      // 小盒子4K 等配置就栽在这上面。
      if (c < ' ') {
        out += ' '
        continue
      }
      out += c
      if (c === '\\') out += input[++i] ?? ''
      else if (c === quote) inStr = false
      continue
    }
    if (c === '"' || c === "'") {
      inStr = true
      quote = c
      out += c
      continue
    }
    if (c === '/' && input[i + 1] === '/') {
      while (i < input.length && input[i] !== '\n') i++
      out += '\n'
      continue
    }
    if (c === '/' && input[i + 1] === '*') {
      i += 2
      while (i < input.length && !(input[i] === '*' && input[i + 1] === '/')) i++
      i++
      continue
    }
    out += c
  }
  return out
}

export function parseTolerantJson(text: string): any {
  const cleaned = stripJsonComments(text.replace(/^\uFEFF/, '')).replace(/,\s*([}\]])/g, '$1')
  try {
    return JSON.parse(cleaned)
  } catch (e) {
    // 部分配置在真正的 JSON 前面塞了说明文字 / 变量声明 —— 从第一个 { 或 [ 重试。
    const start = cleaned.search(/[[{]/)
    if (start > 0) return JSON.parse(cleaned.slice(start))
    throw e
  }
}

// ---- XML → 普通对象 ----------------------------------------------------------
// 紧凑规则:纯文本节点 → string;带子节点的元素 → object;重复标签 → array;
// 属性以 @name 保存,混合文本节点以 #text 保存。
export function xmlToPlain(node: Element): unknown {
  const attrs: Record<string, string> = {}
  for (const attr of Array.from(node.attributes)) attrs[`@${attr.name}`] = attr.value
  const children = Array.from(node.children)
  const text = node.textContent?.trim() ?? ''
  if (!children.length) {
    if (!Object.keys(attrs).length) return text
    return text ? { ...attrs, '#text': text } : attrs
  }
  const obj: Record<string, unknown> = { ...attrs }
  for (const child of children) {
    const key = child.tagName
    const value = xmlToPlain(child)
    if (key in obj) {
      const current = obj[key]
      obj[key] = Array.isArray(current) ? [...current, value] : [current, value]
    } else {
      obj[key] = value
    }
  }
  return obj
}

export function parseXmlDocument(text: string): unknown {
  const doc = new DOMParser().parseFromString(text, 'application/xml')
  const parserError = doc.querySelector('parsererror')
  if (parserError) throw new Error(parserError.textContent?.trim() || 'XML 解析失败')
  return xmlToPlain(doc.documentElement)
}

// ---- 内容分类与错误翻译 ------------------------------------------------------
export function classifyBadContent(text: string): string | null {
  const t = text.trim()
  if (!t) return '端点没有返回任何内容(可能已失效)'
  if (t.startsWith('<')) return '端点返回了网页而不是配置(可能已失效或更换地址)'
  if (/^\$#/.test(t) || /^[0-9a-fA-F]{64,}$/.test(t)) return '该线路是 TVBox 客户端的加密配置,浏览器无法解密'
  return null
}

// ---- 统一入口 -----------------------------------------------------------------
export function decodeResponse(text: string): DecodedDocument {
  const trimmed = String(text).replace(/^\uFEFF/, '').trimStart()
  if (!trimmed) throw new Error(classifyBadContent(text) ?? '响应内容为空')
  if (trimmed.startsWith('<')) {
    try {
      return { kind: 'xml', data: parseXmlDocument(trimmed), raw: text }
    } catch (error) {
      throw new Error(error instanceof Error ? `XML 解析失败:${error.message}` : 'XML 解析失败')
    }
  }
  try {
    return { kind: 'json', data: parseTolerantJson(trimmed), raw: text }
  } catch (error) {
    throw new Error(classifyBadContent(text) ?? (error instanceof Error ? error.message : '配置格式无法解析'))
  }
}

export type FetchDecodedOptions = {
  timeoutMs?: number
  init?: RequestInit
  fetchImpl?: typeof fetch
}

// 带超时与自动格式识别的取数入口;代理地址由调用方拼好。
export async function fetchDecoded(url: string, options: FetchDecodedOptions = {}): Promise<DecodedDocument> {
  const { timeoutMs = 10_000, init, fetchImpl = fetch } = options
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchImpl(url, { ...init, signal: controller.signal })
    if (!response.ok) {
      // 代理错误体是 { error } JSON,透传出来比裸状态码更好排查。
      let detail = ''
      try {
        const body = parseTolerantJson(await response.text())
        if (body && typeof body.error === 'string') detail = `: ${body.error}`
      } catch {
        /* 错误体不是 JSON 时忽略 */
      }
      throw new Error(`HTTP ${response.status}${detail}`)
    }
    return decodeResponse(await response.text())
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw new Error('请求超时')
    throw error
  } finally {
    clearTimeout(timer)
  }
}
