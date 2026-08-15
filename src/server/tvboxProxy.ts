import {
  lookup as dnsLookup,
  type LookupAddress,
  type LookupOptions,
} from "node:dns"
import { BlockList, isIP } from "node:net"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"
import type { IncomingMessage, ServerResponse } from "node:http"
import { Agent, fetch } from "undici"
import type { Plugin } from "vite"

type ResolvedAddress = { address: string; family: 4 | 6 }
type ResolveHost = (hostname: string) => Promise<ResolvedAddress[]>
type AllowAddress = (address: string, hostname: string) => boolean

export type TvboxProxyOptions = {
  allowedRequestHosts?: string[]
  allowAddress?: AllowAddress
  maxConcurrent?: number
  maxDocumentConcurrent?: number
  maxDocumentBytes?: number
  perAttemptTimeoutMs?: number
  resolveHost?: ResolveHost
  resolvePublicHost?: ResolveHost
  totalTimeoutMs?: number
}

export type TvboxProxyMiddleware = (
  req: IncomingMessage,
  res: ServerResponse,
  next: () => void,
) => void | Promise<void>

export type TvboxProxyRuntime = {
  middleware: TvboxProxyMiddleware
  close: () => Promise<void>
}

const UA_OKHTTP = "okhttp/3.15"
const UA_BROWSER =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
const DEFAULT_REQUEST_HOSTS = ["localhost", "127.0.0.1", "::1"]
const DNS_OVER_HTTPS_ENDPOINTS = [
  "https://cloudflare-dns.com/dns-query",
  "https://dns.google/resolve",
]
const DNS_RESPONSE_LIMIT = 64 * 1024
const DNS_CACHE_TTL_MS = 60_000
const DNS_CACHE_MAX_ENTRIES = 512
const MAX_REDIRECTS = 4
const RETRY_DELAYS = [1_000, 3_000]
const MEDIA_PATH = /\.(m3u8|ts|m4s|aac|mp3|mp4|webm|m4v|mov|mkv)($|[?#])/i
const RANGE_HEADER = /^bytes=\d*-\d*$/
const ACTIVE_MIME =
  /^(?:text\/html|application\/xhtml\+xml|image\/svg\+xml|(?:text|application)\/(?:javascript|ecmascript))$/i
const SAFE_IMAGE_MIME =
  /^image\/(?:avif|bmp|gif|jpeg|png|webp|x-icon|vnd\.microsoft\.icon)$/i
const DOCUMENT_MIME =
  /^(?:application\/(?:json|[^;]+\+json|xml|[^;]+\+xml)|text\/(?:plain|xml))$/i

class ProxyError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = "ProxyError"
  }
}

const blockedIpv4Addresses = new BlockList()
const blockedIpv6Addresses = new BlockList()
const fakeIpAddresses = new BlockList()
fakeIpAddresses.addSubnet("198.18.0.0", 15, "ipv4")

for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  blockedIpv4Addresses.addSubnet(network, prefix, "ipv4")
}

for (const [network, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["::", 96],
  ["::ffff:0:0", 96],
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["2001:10::", 28],
  ["2001:db8::", 32],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  blockedIpv6Addresses.addSubnet(network, prefix, "ipv6")
}

const stripIpv6Brackets = (value: string) =>
  value
    .replace(/^\[|\]$/g, "")
    .split("%")[0]
    .toLowerCase()

export function isPublicProxyAddress(address: string): boolean {
  const normalized = stripIpv6Brackets(address)
  const family = isIP(normalized)
  if (family === 4) return !blockedIpv4Addresses.check(normalized, "ipv4")
  if (family === 6) return !blockedIpv6Addresses.check(normalized, "ipv6")
  return false
}

const defaultResolveHost: ResolveHost = (hostname) =>
  new Promise((resolve, reject) => {
    dnsLookup(hostname, { all: true, verbatim: true }, (error, addresses) => {
      if (error) return reject(error)
      resolve(
        addresses
          .filter(
            (item): item is LookupAddress & { family: 4 | 6 } =>
              item.family === 4 || item.family === 6,
          )
          .map(({ address, family }) => ({ address, family })),
      )
    })
  })

async function queryDnsOverHttps(endpoint: string, hostname: string) {
  const records = await Promise.allSettled(
    ["A", "AAAA"].map(async (type) => {
      const url = new URL(endpoint)
      url.searchParams.set("name", hostname)
      url.searchParams.set("type", type)
      const response = await fetch(url, {
        headers: { accept: "application/dns-json" },
        redirect: "error",
        signal: AbortSignal.timeout(5_000),
      })
      if (!response.ok)
        throw new ProxyError(502, "DNS_FAILED", "公共 DNS 查询失败")
      const contentLength = Number(response.headers.get("content-length") ?? 0)
      if (contentLength > DNS_RESPONSE_LIMIT) {
        await response.body?.cancel()
        throw new ProxyError(502, "DNS_FAILED", "公共 DNS 响应异常")
      }
      const text = await response.text()
      if (new TextEncoder().encode(text).byteLength > DNS_RESPONSE_LIMIT)
        throw new ProxyError(502, "DNS_FAILED", "公共 DNS 响应异常")
      const payload = JSON.parse(text) as {
        Status?: number
        Answer?: Array<{ data?: unknown; type?: unknown }>
      }
      if (payload.Status !== 0 && payload.Status !== 3)
        throw new ProxyError(502, "DNS_FAILED", "公共 DNS 查询失败")
      return (payload.Answer ?? []).flatMap((answer) => {
        if (typeof answer.data !== "string") return []
        const family = isIP(answer.data)
        if (
          (answer.type === 1 && family === 4) ||
          (answer.type === 28 && family === 6)
        )
          return [{ address: answer.data, family } as ResolvedAddress]
        return []
      })
    }),
  )
  return records.flatMap((record) =>
    record.status === "fulfilled" ? record.value : [],
  )
}

const defaultResolvePublicHost: ResolveHost = async (hostname) => {
  for (const endpoint of DNS_OVER_HTTPS_ENDPOINTS) {
    try {
      const addresses = await queryDnsOverHttps(endpoint, hostname)
      if (addresses.length) return addresses
    } catch {
      // Try the next fixed HTTPS resolver before returning a stable proxy error.
    }
  }
  throw new ProxyError(502, "DNS_FAILED", "目标域名解析失败")
}

function isFakeIpAddress(address: string) {
  const normalized = stripIpv6Brackets(address)
  return isIP(normalized) === 4 && fakeIpAddresses.check(normalized, "ipv4")
}

function normalizeRequestHost(value: string | undefined): string {
  if (!value) return ""
  const trimmed = value.trim()
  if (!trimmed || /[\\/@?#\s]/.test(trimmed)) return ""
  try {
    return stripIpv6Brackets(new URL(`http://${trimmed}`).hostname)
  } catch {
    return ""
  }
}

function parseTarget(value: string, allowAddress: AllowAddress): URL {
  let target: URL
  try {
    target = new URL(value)
  } catch {
    throw new ProxyError(400, "INVALID_TARGET", "无效的代理地址")
  }
  if (target.protocol !== "http:" && target.protocol !== "https:") {
    throw new ProxyError(400, "INVALID_TARGET", "仅支持 HTTP(S) 地址")
  }
  if (target.username || target.password) {
    throw new ProxyError(400, "INVALID_TARGET", "代理地址不得包含凭据")
  }

  const hostname = stripIpv6Brackets(target.hostname)
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    hostname.endsWith(".home.arpa")
  ) {
    throw new ProxyError(403, "TARGET_BLOCKED", "目标地址不允许访问")
  }
  if (isIP(hostname) && !allowAddress(hostname, hostname)) {
    throw new ProxyError(403, "TARGET_BLOCKED", "目标地址不允许访问")
  }
  return target
}

function findProxyError(error: unknown): ProxyError | null {
  let current: unknown = error
  const seen = new Set<unknown>()
  while (current && !seen.has(current)) {
    if (current instanceof ProxyError) return current
    seen.add(current)
    current = (current as { cause?: unknown }).cause
  }
  return null
}

function setSecurityHeaders(res: ServerResponse) {
  res.setHeader("x-content-type-options", "nosniff")
  res.setHeader("referrer-policy", "no-referrer")
  res.setHeader("cross-origin-resource-policy", "same-origin")
  res.setHeader(
    "content-security-policy",
    "sandbox; default-src 'none'; base-uri 'none'; form-action 'none'",
  )
}

function sendJson(
  res: ServerResponse,
  status: number,
  code: string,
  error: string,
) {
  if (res.destroyed || res.writableEnded) return
  setSecurityHeaders(res)
  res.statusCode = status
  res.setHeader("content-type", "application/json; charset=utf-8")
  res.setHeader("cache-control", "no-store")
  res.end(JSON.stringify({ error, code }))
}

function abortableDelay(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason)
    const timer = setTimeout(done, ms)
    const onAbort = () => {
      clearTimeout(timer)
      signal.removeEventListener("abort", onAbort)
      reject(signal.reason)
    }
    function done() {
      signal.removeEventListener("abort", onAbort)
      resolve()
    }
    signal.addEventListener("abort", onAbort, { once: true })
  })
}

function withTimeout(parent: AbortSignal, timeoutMs: number) {
  const controller = new AbortController()
  const onAbort = () => controller.abort(parent.reason)
  const timer = setTimeout(
    () =>
      controller.abort(new ProxyError(504, "UPSTREAM_TIMEOUT", "上游请求超时")),
    timeoutMs,
  )
  if (parent.aborted) onAbort()
  else parent.addEventListener("abort", onAbort, { once: true })
  return {
    signal: controller.signal,
    cancel: () => {
      clearTimeout(timer)
      parent.removeEventListener("abort", onAbort)
    },
  }
}

async function readTextLimited(
  response: Awaited<ReturnType<typeof fetch>>,
  maxBytes: number,
) {
  if (!response.body) return ""
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel()
        throw new ProxyError(413, "PAYLOAD_TOO_LARGE", "上游文档超过大小限制")
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const body = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(body)
}

const mediaUrl = (value: string) => MEDIA_PATH.test(value)
const mimeOf = (value: string) => value.split(";", 1)[0].trim().toLowerCase()
const isRedirect = (status: number) =>
  [301, 302, 303, 307, 308].includes(status)
const proxyPath = (url: string) => `/__tvbox?u=${encodeURIComponent(url)}`

function rewritePlaylist(
  text: string,
  base: string,
  allowAddress: AllowAddress,
) {
  if (!text.trimStart().startsWith("#EXTM3U")) {
    throw new ProxyError(
      415,
      "CONTENT_BLOCKED",
      "上游未返回有效的 HLS 播放列表",
    )
  }
  const rewriteUri = (value: string) =>
    proxyPath(parseTarget(new URL(value, base).href, allowAddress).href)
  return text
    .split("\n")
    .map((line) => {
      const trimmed = line.trim()
      if (!trimmed) return line
      if (trimmed.startsWith("#")) {
        return trimmed.replace(
          /URI="([^"]+)"/g,
          (_match, uri: string) => `URI="${rewriteUri(uri)}"`,
        )
      }
      return rewriteUri(trimmed)
    })
    .join("\n")
}

export function createTvboxProxyMiddleware(
  options: TvboxProxyOptions = {},
): TvboxProxyRuntime {
  const allowedRequestHosts = new Set(
    [...DEFAULT_REQUEST_HOSTS, ...(options.allowedRequestHosts ?? [])].map(
      stripIpv6Brackets,
    ),
  )
  const allowAddress =
    options.allowAddress ?? ((address: string) => isPublicProxyAddress(address))
  const resolveHost = options.resolveHost ?? defaultResolveHost
  const resolvePublicHost = options.resolvePublicHost ?? defaultResolvePublicHost
  // 媒体分片会占住槽位直到整段传完，目录 / 探活这类文档请求则是短平快的。
  // 共用一个计数器时，后台探活风暴能把播放需要的槽位吃光，表现为 VHS 收到
  // 429 后直接判定致命错误。因此文档请求另有一条更低的上限：它最多只能占用
  // maxDocumentConcurrent 个槽位，剩下的额度对播放永远可用。
  const maxConcurrent = Math.max(1, options.maxConcurrent ?? 64)
  const maxDocumentConcurrent = Math.min(
    maxConcurrent,
    Math.max(1, options.maxDocumentConcurrent ?? 24),
  )
  const maxDocumentBytes = options.maxDocumentBytes ?? 8 * 1024 * 1024
  const perAttemptTimeoutMs = options.perAttemptTimeoutMs ?? 15_000
  const totalTimeoutMs = options.totalTimeoutMs ?? 35_000
  const publicDnsCache = new Map<
    string,
    { addresses: ResolvedAddress[]; expiresAt: number }
  >()
  let active = 0
  let activeDocuments = 0

  const resolveSocketAddresses = async (hostname: string) => {
    let addresses: ResolvedAddress[]
    try {
      addresses = await resolveHost(hostname)
    } catch {
      throw new ProxyError(502, "DNS_FAILED", "目标域名解析失败")
    }
    if (!addresses.length || !addresses.every((item) => isFakeIpAddress(item.address)))
      return addresses

    const cached = publicDnsCache.get(hostname)
    if (cached && cached.expiresAt > Date.now()) return cached.addresses

    let publicAddresses: ResolvedAddress[]
    try {
      publicAddresses = await resolvePublicHost(hostname)
    } catch (error) {
      const known = findProxyError(error)
      if (known) throw known
      throw new ProxyError(502, "DNS_FAILED", "目标域名解析失败")
    }
    if (publicDnsCache.size >= DNS_CACHE_MAX_ENTRIES) {
      const oldest = publicDnsCache.keys().next().value
      if (oldest) publicDnsCache.delete(oldest)
    }
    publicDnsCache.set(hostname, {
      addresses: publicAddresses,
      expiresAt: Date.now() + DNS_CACHE_TTL_MS,
    })
    return publicAddresses
  }

  const secureLookup = (
    hostname: string,
    lookupOptions: LookupOptions,
    callback: (
      error: NodeJS.ErrnoException | null,
      address: string | LookupAddress[],
      family?: number,
    ) => void,
  ) => {
    resolveSocketAddresses(hostname)
      .then((addresses) => {
        if (
          !addresses.length ||
          addresses.some((item) => !allowAddress(item.address, hostname))
        ) {
          throw new ProxyError(
            403,
            "TARGET_BLOCKED",
            "目标域名解析到不允许的地址",
          )
        }
        const family =
          lookupOptions.family === 4 || lookupOptions.family === 6
            ? lookupOptions.family
            : 0
        const candidates = family
          ? addresses.filter((item) => item.family === family)
          : addresses
        if (!candidates.length)
          throw new ProxyError(502, "DNS_FAILED", "目标域名无可用地址")
        if (lookupOptions.all) callback(null, candidates)
        else callback(null, candidates[0].address, candidates[0].family)
      })
      .catch((error: Error) => callback(error as NodeJS.ErrnoException, "", 0))
  }

  const dispatcher = new Agent({
    connect: {
      lookup: secureLookup,
    },
  })

  const fetchRedirects = async (
    initial: URL,
    method: "GET" | "HEAD",
    headers: Record<string, string>,
    signal: AbortSignal,
  ) => {
    let current = initial
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      const response = await fetch(current, {
        dispatcher,
        headers,
        method,
        redirect: "manual",
        signal,
      })
      if (!isRedirect(response.status))
        return { response, finalUrl: current.href }
      const location = response.headers.get("location")
      await response.body?.cancel()
      if (!location)
        throw new ProxyError(502, "BAD_REDIRECT", "上游重定向缺少 Location")
      if (hop === MAX_REDIRECTS)
        throw new ProxyError(502, "TOO_MANY_REDIRECTS", "上游重定向过多")
      current = parseTarget(new URL(location, current).href, allowAddress)
    }
    throw new ProxyError(502, "TOO_MANY_REDIRECTS", "上游重定向过多")
  }

  const fetchOnce = async (
    target: URL,
    method: "GET" | "HEAD",
    range: string | undefined,
    signal: AbortSignal,
  ) => {
    const baseHeaders = {
      accept: "application/json, application/xml, text/xml, text/plain, */*",
      "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
      ...(range ? { range } : {}),
    }
    const first = await fetchRedirects(
      target,
      method,
      { ...baseHeaders, "user-agent": UA_OKHTTP },
      signal,
    )
    const retryWithBrowser =
      method === "GET" &&
      !mediaUrl(target.href) &&
      (first.response.status === 403 ||
        first.response.status === 429 ||
        first.response.status >= 500)
    if (!retryWithBrowser) return first
    await first.response.body?.cancel()
    return fetchRedirects(
      target,
      method,
      {
        ...baseHeaders,
        referer: `${target.origin}/`,
        "user-agent": UA_BROWSER,
      },
      signal,
    )
  }

  const fetchUpstream = async (
    target: URL,
    method: "GET" | "HEAD",
    range: string | undefined,
    signal: AbortSignal,
  ) => {
    let lastError: unknown
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const timed = withTimeout(signal, perAttemptTimeoutMs)
      try {
        return await fetchOnce(target, method, range, timed.signal)
      } catch (error) {
        lastError = error
        const known = findProxyError(error)
        if ((known && known.code !== "UPSTREAM_TIMEOUT") || signal.aborted)
          throw error
        if (attempt < 2) await abortableDelay(RETRY_DELAYS[attempt], signal)
      } finally {
        timed.cancel()
      }
    }
    throw lastError
  }

  const middleware: TvboxProxyMiddleware = async (req, res, next) => {
    const requestUrl = new URL(req.url ?? "/", "http://localhost")
    if (requestUrl.pathname !== "/__tvbox" && requestUrl.pathname !== "/")
      return next()
    setSecurityHeaders(res)

    const requestHost = normalizeRequestHost(req.headers.host)
    if (!allowedRequestHosts.has(requestHost)) {
      sendJson(res, 403, "REQUEST_HOST_BLOCKED", "代理仅允许本机访问")
      return
    }
    if (
      req.headers["sec-fetch-site"] === "cross-site" ||
      req.headers["sec-fetch-site"] === "same-site"
    ) {
      sendJson(res, 403, "CROSS_SITE_BLOCKED", "代理不接受跨站请求")
      return
    }
    if (req.method === "OPTIONS") {
      res.statusCode = 204
      res.end()
      return
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      sendJson(res, 405, "METHOD_NOT_ALLOWED", "仅支持 GET 和 HEAD")
      return
    }
    const range =
      typeof req.headers.range === "string" ? req.headers.range : undefined
    if (range && !RANGE_HEADER.test(range)) {
      sendJson(res, 400, "INVALID_RANGE", "仅支持单段 bytes Range")
      return
    }

    let target: URL
    try {
      target = parseTarget(requestUrl.searchParams.get("u") ?? "", allowAddress)
    } catch (error) {
      const known = findProxyError(error)
      sendJson(
        res,
        known?.status ?? 400,
        known?.code ?? "INVALID_TARGET",
        known?.message ?? "无效的代理地址",
      )
      return
    }

    // 播放链路(m3u8 / 分片)吃总额度；目录、详情、探活等文档请求另受更低的
    // 上限约束，保证它们无论怎么突发都留得下播放需要的槽位。
    const isMediaRequest = mediaUrl(target.href)
    if (
      active >= maxConcurrent ||
      (!isMediaRequest && activeDocuments >= maxDocumentConcurrent)
    ) {
      res.setHeader("retry-after", "1")
      sendJson(res, 429, "TOO_MANY_REQUESTS", "代理并发请求过多")
      return
    }

    active += 1
    if (!isMediaRequest) activeDocuments += 1
    const controller = new AbortController()
    const totalTimer = setTimeout(
      () =>
        controller.abort(
          new ProxyError(504, "UPSTREAM_TIMEOUT", "上游请求超时"),
        ),
      totalTimeoutMs,
    )
    const abortClient = () => {
      if (!res.writableEnded)
        controller.abort(new ProxyError(499, "CLIENT_CLOSED", "客户端已断开"))
    }
    req.once("aborted", abortClient)
    res.once("close", abortClient)
    res.setTimeout(perAttemptTimeoutMs, abortClient)

    try {
      const { response: upstream, finalUrl } = await fetchUpstream(
        target,
        req.method,
        range,
        controller.signal,
      )
      if (!upstream.ok && upstream.status !== 206) {
        await upstream.body?.cancel()
        throw new ProxyError(
          upstream.status,
          "UPSTREAM_HTTP_ERROR",
          `上游返回 HTTP ${upstream.status}`,
        )
      }

      const contentType = upstream.headers.get("content-type") ?? ""
      const mime = mimeOf(contentType)
      const hls =
        /mpegurl|m3u8/i.test(mime) ||
        new URL(finalUrl).pathname.toLowerCase().endsWith(".m3u8")
      if (ACTIVE_MIME.test(mime) && mime !== "text/html") {
        await upstream.body?.cancel()
        throw new ProxyError(
          415,
          "CONTENT_BLOCKED",
          "上游返回了不安全的活动内容",
        )
      }

      res.statusCode = upstream.status
      for (const header of [
        "accept-ranges",
        "content-range",
        "etag",
        "last-modified",
      ] as const) {
        const value = upstream.headers.get(header)
        if (value) res.setHeader(header, value)
      }

      if (req.method === "HEAD") {
        if (ACTIVE_MIME.test(mime)) {
          await upstream.body?.cancel()
          throw new ProxyError(
            415,
            "CONTENT_BLOCKED",
            "上游返回了不安全的活动内容",
          )
        }
        res.setHeader("content-type", contentType || "application/octet-stream")
        await upstream.body?.cancel()
        res.end()
        return
      }

      if (hls) {
        const text = await readTextLimited(upstream, maxDocumentBytes)
        const rewritten = rewritePlaylist(text, finalUrl, allowAddress)
        res.setHeader(
          "content-type",
          "application/vnd.apple.mpegurl; charset=utf-8",
        )
        res.setHeader("cache-control", "no-store")
        res.end(rewritten)
        return
      }

      if (mime === "text/html") {
        const text = await readTextLimited(upstream, maxDocumentBytes)
        try {
          const parsed = JSON.parse(text)
          if (
            parsed == null ||
            (typeof parsed !== "object" && !Array.isArray(parsed))
          )
            throw new Error("not a document")
        } catch {
          throw new ProxyError(
            415,
            "CONTENT_BLOCKED",
            "上游返回了 HTML 活动内容",
          )
        }
        res.setHeader("content-type", "application/json; charset=utf-8")
        res.setHeader("content-disposition", "attachment")
        res.setHeader("cache-control", "no-store")
        res.end(text)
        return
      }

      if (
        DOCUMENT_MIME.test(mime) ||
        (!mediaUrl(finalUrl) &&
          !SAFE_IMAGE_MIME.test(mime) &&
          !/^(?:audio|video)\//.test(mime))
      ) {
        const text = await readTextLimited(upstream, maxDocumentBytes)
        res.setHeader("content-type", contentType || "application/octet-stream")
        res.setHeader("content-disposition", "attachment")
        res.setHeader("cache-control", "no-store")
        res.end(text)
        return
      }

      if (mime.startsWith("image/") && !SAFE_IMAGE_MIME.test(mime)) {
        await upstream.body?.cancel()
        throw new ProxyError(
          415,
          "CONTENT_BLOCKED",
          "上游返回了不安全的图片类型",
        )
      }

      res.setHeader("content-type", contentType || "application/octet-stream")
      if (SAFE_IMAGE_MIME.test(mime))
        res.setHeader("cache-control", "public, max-age=86400, immutable")
      else res.setHeader("cache-control", "public, max-age=21600")
      if (!upstream.body) {
        res.end()
        return
      }
      await pipeline(
        Readable.fromWeb(
          upstream.body as import("node:stream/web").ReadableStream,
        ),
        res,
        { signal: controller.signal },
      )
    } catch (error) {
      if (res.headersSent || res.destroyed || res.writableEnded) return
      const known = findProxyError(error)
      if (known?.code === "CLIENT_CLOSED") return
      sendJson(
        res,
        known?.status ?? 502,
        known?.code ?? "UPSTREAM_FAILED",
        known?.message ?? "上游请求失败",
      )
    } finally {
      clearTimeout(totalTimer)
      req.removeListener("aborted", abortClient)
      res.removeListener("close", abortClient)
      active -= 1
      if (!isMediaRequest) activeDocuments -= 1
    }
  }

  return {
    middleware,
    close: async () => {
      await dispatcher.close()
    },
  }
}

export function tvboxProxyPlugin(options: TvboxProxyOptions = {}): Plugin {
  return {
    name: "tvbox-proxy",
    apply: "serve",
    configureServer(server) {
      const runtime = createTvboxProxyMiddleware(options)
      server.middlewares.use("/__tvbox", runtime.middleware)
      server.httpServer?.once("close", () => void runtime.close())
    },
  }
}
