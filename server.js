const http = require("http");
const fs = require("fs");
const path = require("path");
const { pipeline } = require("stream");

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, "public");
const MAX_DOWNLOAD_BYTES = 128 * 1024 * 1024;
const MAX_UPLOAD_BYTES = 128 * 1024 * 1024;

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
  ".ico": "image/x-icon"
};

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    "Cache-Control": "no-store"
  });
  res.end(payload);
}

function clampNumber(value, fallback, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

function serveStatic(req, res, pathname) {
  const requestedPath = pathname === "/" ? "/index.html" : pathname;
  const normalizedPath = path.normalize(decodeURIComponent(requestedPath)).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(PUBLIC_DIR, normalizedPath);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    sendJson(res, 403, { error: "Forbidden" });
    return;
  }

  fs.stat(filePath, (statError, stat) => {
    if (statError || !stat.isFile()) {
      sendJson(res, 404, { error: "Not found" });
      return;
    }

    const extension = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      "Content-Type": mimeTypes[extension] || "application/octet-stream",
      "Content-Length": stat.size,
      "Cache-Control": extension === ".html" ? "no-cache" : "public, max-age=3600"
    });

    pipeline(fs.createReadStream(filePath), res, (streamError) => {
      if (streamError && !res.destroyed) res.destroy(streamError);
    });
  });
}

function handleDownload(req, res, url) {
  const size = clampNumber(url.searchParams.get("size"), 16 * 1024 * 1024, MAX_DOWNLOAD_BYTES);
  const chunk = Buffer.alloc(64 * 1024);
  let remaining = size;

  res.writeHead(200, {
    "Content-Type": "application/octet-stream",
    "Content-Length": size,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });

  function writeChunk() {
    while (remaining > 0) {
      const bytes = Math.min(chunk.length, remaining);
      remaining -= bytes;
      if (!res.write(bytes === chunk.length ? chunk : chunk.subarray(0, bytes))) {
        res.once("drain", writeChunk);
        return;
      }
    }
    res.end();
  }

  writeChunk();
}

function handleUpload(req, res) {
  const started = process.hrtime.bigint();
  let received = 0;

  req.on("data", (chunk) => {
    received += chunk.length;
    if (received > MAX_UPLOAD_BYTES) {
      req.destroy();
      sendJson(res, 413, { error: "Upload too large" });
    }
  });

  req.on("end", () => {
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
    sendJson(res, 200, {
      bytes: received,
      milliseconds: Math.round(elapsedMs),
      receivedAt: new Date().toISOString()
    });
  });

  req.on("error", () => {
    if (!res.headersSent) sendJson(res, 400, { error: "Upload failed" });
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  if (req.method === "GET" && url.pathname === "/health") {
    sendJson(res, 200, { ok: true, service: "speedtest", time: new Date().toISOString() });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/ping") {
    sendJson(res, 200, { pong: true, serverTime: Date.now() });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/download") {
    handleDownload(req, res, url);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/upload") {
    handleUpload(req, res);
    return;
  }

  if (req.method === "GET" || req.method === "HEAD") {
    serveStatic(req, res, url.pathname);
    return;
  }

  sendJson(res, 405, { error: "Method not allowed" });
});

server.listen(PORT, () => {
  console.log(`Speedtest server listening on port ${PORT}`);
});
