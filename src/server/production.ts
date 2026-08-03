import { createServer, type ServerResponse } from "node:http"
import { createTvboxProxyMiddleware } from "./tvboxProxy.js"

const host = process.env.PROXY_HOST?.trim() || "127.0.0.1"
const rawPort = Number(process.env.PROXY_PORT ?? 8787)
const port = Number.isInteger(rawPort) && rawPort > 0 && rawPort <= 65535 ? rawPort : 8787
const allowedRequestHosts = (process.env.TVBOX_PROXY_ALLOWED_HOSTS ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean)

const runtime = createTvboxProxyMiddleware({
  allowedRequestHosts: allowedRequestHosts.length ? allowedRequestHosts : undefined,
})

function sendJson(res: ServerResponse, status: number, payload: object, head = false) {
  const body = JSON.stringify(payload)
  res.statusCode = status
  res.setHeader("content-type", "application/json; charset=utf-8")
  res.setHeader("cache-control", "no-store")
  res.setHeader("x-content-type-options", "nosniff")
  res.end(head ? undefined : body)
}

const server = createServer((req, res) => {
  const requestUrl = new URL(req.url ?? "/", "http://localhost")

  if (requestUrl.pathname === "/healthz") {
    if (req.method !== "GET" && req.method !== "HEAD") {
      sendJson(res, 405, { error: "METHOD_NOT_ALLOWED" })
      return
    }
    sendJson(res, 200, { ok: true }, req.method === "HEAD")
    return
  }

  if (requestUrl.pathname !== "/__tvbox") {
    sendJson(res, 404, { error: "NOT_FOUND" })
    return
  }

  void Promise.resolve(
    runtime.middleware(req, res, () => sendJson(res, 404, { error: "NOT_FOUND" })),
  ).catch(() => {
    if (!res.headersSent && !res.writableEnded) {
      sendJson(res, 500, { error: "PROXY_FAILED" })
    }
  })
})

server.keepAliveTimeout = 65_000
server.headersTimeout = 66_000

server.on("clientError", (_error, socket) => {
  if (!socket.writable) return
  socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n")
})

let shuttingDown = false
const shutdown = () => {
  if (shuttingDown) return
  shuttingDown = true
  const forced = setTimeout(() => process.exit(1), 40_000)
  forced.unref()
  server.close(() => {
    void runtime.close().finally(() => process.exit(0))
  })
}

process.once("SIGTERM", shutdown)
process.once("SIGINT", shutdown)

server.listen(port, host, () => {
  console.log(`NebulaPlay proxy listening on http://${host}:${port}`)
})
