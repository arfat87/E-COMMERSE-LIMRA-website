import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3000;

// Resolve static dist directory from frontend/dist
const CANDIDATE_DIST_DIRS = [
  path.join(__dirname, "../frontend/dist"),
  path.join(__dirname, "dist"),
  path.join(__dirname, "../dist")
];

let DIST_DIR = CANDIDATE_DIST_DIRS.find(dir => fs.existsSync(dir)) || path.join(__dirname, "../frontend/dist");
const FRONTEND_DIR = path.join(__dirname, "../frontend");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf"
};

const apiHandlers = {
  "/api/db": () => import("./api/db.js"),
  "/api/orders": () => import("./api/orders.js"),
  "/api/menu": () => import("./api/menu.js"),
  "/api/db-status": () => import("./api/db-status.js"),
  "/api/verify-payment": () => import("./api/verify-payment.js"),
  "/api/create-order": () => import("./api/create-order.js"),
  "/api/analytics": () => import("./api/analytics.js")
};

async function parseBody(req) {
  return new Promise((resolve) => {
    if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") {
      return resolve({});
    }
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString();
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        resolve(raw);
      }
    });
  });
}

const server = http.createServer(async (req, res) => {
  const reqUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const pathname = reqUrl.pathname.replace(/\/+$/, "") || "/";

  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization"
  );

  if (req.method === "OPTIONS") {
    res.statusCode = 200;
    return res.end();
  }

  // 1. API ROUTES DISPATCHER
  if (pathname.startsWith("/api/")) {
    const handlerLoader = apiHandlers[pathname];
    if (handlerLoader) {
      try {
        const { default: handler } = await handlerLoader();
        const body = await parseBody(req);
        
        const mockReq = {
          method: req.method,
          url: req.url,
          query: Object.fromEntries(reqUrl.searchParams.entries()),
          body,
          headers: req.headers
        };

        const mockRes = {
          statusCode: 200,
          setHeader: (k, v) => res.setHeader(k, v),
          getHeader: (k) => res.getHeader(k),
          status(code) {
            res.statusCode = code;
            return this;
          },
          json(data) {
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify(data));
            return this;
          },
          send(data) {
            res.end(typeof data === "string" ? data : JSON.stringify(data));
            return this;
          },
          end(data) {
            res.end(data);
            return this;
          }
        };

        return await handler(mockReq, mockRes);
      } catch (err) {
        console.error(`[API Error ${pathname}]:`, err);
        res.statusCode = 500;
        res.setHeader("Content-Type", "application/json");
        return res.end(JSON.stringify({ error: err.message || "Internal Server Error" }));
      }
    } else {
      res.statusCode = 404;
      res.setHeader("Content-Type", "application/json");
      return res.end(JSON.stringify({ error: `API route ${pathname} not found` }));
    }
  }

  // 2. STATIC FILE SERVING
  let relativePath = pathname === "/" ? "index.html" : pathname.slice(1);
  let filePath = path.join(DIST_DIR, relativePath);

  if (!fs.existsSync(filePath) && fs.existsSync(filePath + ".html")) {
    filePath = filePath + ".html";
  }

  // Fallback to frontend raw directory if dist is not yet built
  if (!fs.existsSync(filePath)) {
    let rawPath = path.join(FRONTEND_DIR, relativePath);
    if (!fs.existsSync(rawPath) && fs.existsSync(rawPath + ".html")) {
      rawPath = rawPath + ".html";
    }
    if (fs.existsSync(rawPath)) {
      filePath = rawPath;
    }
  }

  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || "application/octet-stream";
    res.statusCode = 200;
    res.setHeader("Content-Type", contentType);
    return fs.createReadStream(filePath).pipe(res);
  }

  const fallbackIndex = path.join(DIST_DIR, "index.html");
  if (fs.existsSync(fallbackIndex)) {
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return fs.createReadStream(fallbackIndex).pipe(res);
  }

  res.statusCode = 404;
  res.end("404 Not Found");
});

server.listen(PORT, async () => {
  console.log(`\n==================================================`);
  console.log(`🚀 LIMRA RESTAURANT — BACKEND API SERVER RUNNING`);
  console.log(`📍 Local URL:       http://localhost:${PORT}`);
  console.log(`📊 Admin Login:     http://localhost:${PORT}/admin-login.html`);
  console.log(`🍽️ Table Order:     http://localhost:${PORT}/table/index.html`);
  console.log(`📦 Stock Manager:   http://localhost:${PORT}/stock-manager/index.html`);
  console.log(`==================================================\n`);

  try {
    const { pingDatabase } = await import("./api/lib/insforge.js");
    const ping = await pingDatabase();
    console.log(`✅ InsForge PostgreSQL Connection Verified:`, ping);
  } catch (err) {
    console.error(`❌ InsForge Connection Notice:`, err.message);
  }
});
