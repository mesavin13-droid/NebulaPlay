// @vitest-environment node

import { once } from "node:events"
import {
  createServer,
  request,
  type RequestListener,
  type Server,
} from "node:http"
import { afterEach, describe, expect, it } from "vitest"
import {
  createTvboxProxyMiddleware,
  isPublicProxyAddress,
  type TvboxProxyRuntime,
} from "./tvboxProxy"

const servers: Server[] = []
const runtimes: TvboxProxyRuntime[] = []

async function listen(handler: RequestListener): Promise<string> {
  const server = createServer(handler)
  servers.push(server)
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  const address = server.address()
  if (!address || typeof address === "string")
    throw new Error("test server did not bind a TCP port")
  return `http://127.0.0.1:${address.port}`
}

async function proxyForLocalUpstream(
  options: { maxDocumentBytes?: number } = {},
) {
  const runtime = createTvboxProxyMiddleware({
    ...options,
    allowedRequestHosts: ["127.0.0.1"],
    resolveHost: async () => [{ address: "127.0.0.1", family: 4 }],
    allowAddress: (_address, hostname) => hostname === "upstream.test",
  })
  runtimes.push(runtime)
  const origin = await listen((req, res) =>
    runtime.middleware(req, res, () => {
      res.statusCode = 404
      res.end("not found")
    }),
  )
  return { origin, runtime }
}

const proxied = (origin: string, target: string) =>
  `${origin}/__tvbox?u=${encodeURIComponent(target)}`

function rawRequest(url: string, headers: Record<string, string>) {
  const target = new URL(url)
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = request(
      {
        hostname: target.hostname,
        port: target.port,
        path: `${target.pathname}${target.search}`,
        headers,
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on("data", (chunk) => chunks.push(Buffer.from(chunk)))
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString(),
          }),
        )
      },
    )
    req.on("error", reject)
    req.end()
  })
}

afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.close()))
  await Promise.all(servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve())
          server.closeAllConnections?.()
        }),
    ))
})

describe("/__tvbox security boundary", () => {
  it("classifies public, private, reserved, and IPv4-mapped addresses", () => {
    expect(isPublicProxyAddress("104.20.23.154")).toBe(true)
    expect(isPublicProxyAddress("2606:4700:10::6814:179a")).toBe(true)
    for (const address of [
      "127.0.0.1",
      "10.0.0.1",
      "172.16.0.1",
      "192.168.0.1",
      "198.18.0.42",
      "::1",
      "::ffff:127.0.0.1",
      "fc00::1",
    ]) {
      expect(isPublicProxyAddress(address), address).toBe(false)
    }
  })

  it("rejects loopback targets and non-loopback request hosts before any upstream request", async () => {
    let hits = 0
    const upstream = await listen((_req, res) => {
      hits += 1
      res.end("secret")
    })
    const runtime = createTvboxProxyMiddleware()
    runtimes.push(runtime)
    const proxy = await listen((req, res) =>
      runtime.middleware(req, res, () => res.end()),
    )

    const port = new URL(upstream).port
    for (const target of [
      `${upstream}/secret`,
      `http://2130706433:${port}/secret`,
      `http://[::ffff:127.0.0.1]:${port}/secret`,
    ]) {
      const blocked = await fetch(proxied(proxy, target))
      expect(blocked.status).toBe(403)
      expect(await blocked.json()).toMatchObject({ code: "TARGET_BLOCKED" })
      expect(blocked.headers.get("access-control-allow-origin")).toBeNull()
    }
    expect(hits).toBe(0)

    const hostBlocked = await rawRequest(
      proxied(proxy, "https://example.com/catalog.json"),
      {
        host: "attacker.test",
      },
    )
    expect(hostBlocked.status).toBe(403)
    expect(JSON.parse(hostBlocked.body)).toMatchObject({
      code: "REQUEST_HOST_BLOCKED",
    })

    const disguisedHost = await rawRequest(
      proxied(proxy, "https://example.com/catalog.json"),
      {
        host: "attacker.test@127.0.0.1",
      },
    )
    expect(disguisedHost.status).toBe(403)
    expect(JSON.parse(disguisedHost.body)).toMatchObject({
      code: "REQUEST_HOST_BLOCKED",
    })

    const crossSite = await rawRequest(
      proxied(proxy, "https://example.com/catalog.json"),
      {
        host: "127.0.0.1",
        "sec-fetch-site": "cross-site",
      },
    )
    expect(crossSite.status).toBe(403)
    expect(JSON.parse(crossSite.body)).toMatchObject({
      code: "CROSS_SITE_BLOCKED",
    })

    const dnsRuntime = createTvboxProxyMiddleware({
      allowedRequestHosts: ["127.0.0.1"],
      resolveHost: async () => [{ address: "127.0.0.1", family: 4 }],
    })
    runtimes.push(dnsRuntime)
    const dnsProxy = await listen((req, res) =>
      dnsRuntime.middleware(req, res, () => res.end()),
    )
    const dnsBlocked = await fetch(
      proxied(dnsProxy, `http://public.test:${port}/secret`),
    )
    expect(dnsBlocked.status).toBe(403)
    expect(await dnsBlocked.json()).toMatchObject({ code: "TARGET_BLOCKED" })
    expect(hits).toBe(0)

    const fakeIpRuntime = createTvboxProxyMiddleware({
      allowedRequestHosts: ["127.0.0.1"],
      resolveHost: async () => [{ address: "198.18.0.42", family: 4 }],
      resolvePublicHost: async () => [{ address: "127.0.0.1", family: 4 }],
    })
    runtimes.push(fakeIpRuntime)
    const fakeIpProxy = await listen((req, res) =>
      fakeIpRuntime.middleware(req, res, () => res.end()),
    )
    const fakeIpBlocked = await fetch(
      proxied(fakeIpProxy, `http://public.test:${port}/secret`),
    )
    expect(fakeIpBlocked.status).toBe(403)
    expect(await fakeIpBlocked.json()).toMatchObject({ code: "TARGET_BLOCKED" })
    expect(hits).toBe(0)
  })

  it("pins a public DNS answer when system DNS returns a TUN fake IP", async () => {
    let publicDnsCalls = 0
    const upstream = await listen((_req, res) => {
      res.setHeader("content-type", "application/json")
      res.end('{"list":[]}')
    })
    const port = new URL(upstream).port
    const runtime = createTvboxProxyMiddleware({
      allowedRequestHosts: ["127.0.0.1"],
      resolveHost: async () => [{ address: "198.18.0.42", family: 4 }],
      resolvePublicHost: async () => {
        publicDnsCalls += 1
        return [{ address: "127.0.0.1", family: 4 }]
      },
      allowAddress: (address, hostname) =>
        hostname === "upstream.test" && address === "127.0.0.1",
    })
    runtimes.push(runtime)
    const proxy = await listen((req, res) =>
      runtime.middleware(req, res, () => res.end()),
    )

    for (let index = 0; index < 2; index += 1) {
      const response = await fetch(
        proxied(proxy, `http://upstream.test:${port}/catalog`),
      )
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ list: [] })
    }
    expect(publicDnsCalls).toBe(1)
  })

  it("revalidates redirect targets and refuses a public-looking hop into loopback", async () => {
    let secretHits = 0
    let upstream = ""
    upstream = await listen((req, res) => {
      if (req.url === "/redirect") {
        res.statusCode = 302
        res.setHeader("location", `${upstream}/secret`)
        return res.end()
      }
      secretHits += 1
      res.end("secret")
    })
    const { origin: proxy } = await proxyForLocalUpstream()
    const port = new URL(upstream).port

    const response = await fetch(
      proxied(proxy, `http://upstream.test:${port}/redirect`),
    )
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ code: "TARGET_BLOCKED" })
    expect(secretHits).toBe(0)
  })

  it("blocks active HTML/SVG but safely normalizes JSON mislabeled as HTML", async () => {
    const upstream = await listen((req, res) => {
      if (req.url === "/page") {
        res.setHeader("content-type", "text/html")
        return res.end("<script>globalThis.pwned = true</script>")
      }
      if (req.url === "/image.svg") {
        res.setHeader("content-type", "image/svg+xml")
        return res.end(
          '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
        )
      }
      res.setHeader("content-type", "text/html; charset=utf-8")
      res.end('{"list":[]}')
    })
    const { origin: proxy } = await proxyForLocalUpstream()
    const port = new URL(upstream).port

    for (const path of ["/page", "/image.svg"]) {
      const response = await fetch(
        proxied(proxy, `http://upstream.test:${port}${path}`),
      )
      expect(response.status).toBe(415)
      expect(await response.json()).toMatchObject({ code: "CONTENT_BLOCKED" })
    }

    const json = await fetch(
      proxied(proxy, `http://upstream.test:${port}/catalog`),
    )
    expect(json.status).toBe(200)
    expect(json.headers.get("content-type")).toBe(
      "application/json; charset=utf-8",
    )
    expect(json.headers.get("content-disposition")).toBe("attachment")
    expect(json.headers.get("x-content-type-options")).toBe("nosniff")
    expect(json.headers.get("content-security-policy")).toContain(
      "default-src 'none'",
    )
    expect(json.headers.get("access-control-allow-origin")).toBeNull()
    expect(await json.json()).toEqual({ list: [] })
  })

  it("preserves HLS rewriting, HEAD, Range, and range response headers", async () => {
    const methods: string[] = []
    const upstream = await listen((req, res) => {
      methods.push(req.method ?? "")
      if (req.url === "/master.m3u8") {
        res.setHeader("content-type", "application/vnd.apple.mpegurl")
        return res.end(
          '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="/key"\nvariant.m3u8\n',
        )
      }
      if (req.url === "/video.mp4" && req.method === "HEAD") {
        res.setHeader("content-type", "video/mp4")
        res.setHeader("accept-ranges", "bytes")
        return res.end()
      }
      if (req.url === "/video.mp4" && req.headers.range === "bytes=2-5") {
        res.statusCode = 206
        res.setHeader("content-type", "video/mp4")
        res.setHeader("accept-ranges", "bytes")
        res.setHeader("content-range", "bytes 2-5/10")
        return res.end("2345")
      }
      res.statusCode = 404
      res.end()
    })
    const { origin: proxy } = await proxyForLocalUpstream()
    const port = new URL(upstream).port
    const publicOrigin = `http://upstream.test:${port}`

    const manifest = await fetch(proxied(proxy, `${publicOrigin}/master.m3u8`))
    const manifestText = await manifest.text()
    expect(manifest.status).toBe(200)
    expect(manifestText).toContain(
      `/__tvbox?u=${encodeURIComponent(`${publicOrigin}/variant.m3u8`)}`,
    )
    expect(manifestText).toContain(
      `/__tvbox?u=${encodeURIComponent(`${publicOrigin}/key`)}`,
    )

    const ranged = await fetch(proxied(proxy, `${publicOrigin}/video.mp4`), {
      headers: { range: "bytes=2-5" },
    })
    expect(ranged.status).toBe(206)
    expect(ranged.headers.get("content-range")).toBe("bytes 2-5/10")
    expect(ranged.headers.get("accept-ranges")).toBe("bytes")
    expect(await ranged.text()).toBe("2345")

    const head = await fetch(proxied(proxy, `${publicOrigin}/video.mp4`), {
      method: "HEAD",
    })
    expect(head.status).toBe(200)
    expect(await head.text()).toBe("")
    expect(methods).toContain("HEAD")
  })

  it("enforces manifest/document byte limits", async () => {
    const upstream = await listen((_req, res) => {
      res.setHeader("content-type", "application/vnd.apple.mpegurl")
      res.end(`#EXTM3U\n${"x".repeat(256)}`)
    })
    const { origin: proxy } = await proxyForLocalUpstream({
      maxDocumentBytes: 64,
    })
    const port = new URL(upstream).port

    const response = await fetch(
      proxied(proxy, `http://upstream.test:${port}/large.m3u8`),
    )
    expect(response.status).toBe(413)
    expect(await response.json()).toMatchObject({ code: "PAYLOAD_TOO_LARGE" })
  })

  it("aborts the upstream stream when the client disconnects", async () => {
    let markClosed: () => void
    const upstreamClosed = new Promise<void>((resolve) => {
      markClosed = resolve
    })
    const upstream = await listen((_req, res) => {
      res.setHeader("content-type", "video/mp4")
      const timer = setInterval(() => res.write(Buffer.alloc(1024)), 10)
      res.once("close", () => {
        clearInterval(timer)
        markClosed()
      })
    })
    const { origin: proxy } = await proxyForLocalUpstream()
    const port = new URL(upstream).port

    await new Promise<void>((resolve, reject) => {
      const client = request(
        proxied(proxy, `http://upstream.test:${port}/stream.mp4`),
        (response) => {
          response.once("data", () => {
            response.destroy()
            client.destroy()
            resolve()
          })
        },
      )
      client.on("error", (error) => {
        if ((error as NodeJS.ErrnoException).code === "ECONNRESET") resolve()
        else reject(error)
      })
      client.end()
    })

    await Promise.race([
      upstreamClosed,
      new Promise<never>((_resolve, reject) =>
        setTimeout(
          () => reject(new Error("upstream stream remained open")),
          1_000,
        ),
      ),
    ])
  })
})
