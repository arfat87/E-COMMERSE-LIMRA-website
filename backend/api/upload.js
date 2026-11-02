import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PUBLIC_UPLOADS_DIR = path.join(__dirname, "../../frontend/public/uploads/menu");
const DIST_UPLOADS_DIR = path.join(__dirname, "../../frontend/dist/uploads/menu");

// Ensure directories exist
try {
  if (!fs.existsSync(PUBLIC_UPLOADS_DIR)) {
    fs.mkdirSync(PUBLIC_UPLOADS_DIR, { recursive: true });
  }
} catch (e) {
  console.warn("[Upload Init] Warning creating public uploads dir:", e.message);
}

try {
  if (!fs.existsSync(DIST_UPLOADS_DIR)) {
    fs.mkdirSync(DIST_UPLOADS_DIR, { recursive: true });
  }
} catch (e) {
  // dist may not exist before build, ignore
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ success: false, error: "Method Not Allowed. Use POST." });
    }

    const { image, filename } = req.body || {};

    if (!image) {
      return res.status(400).json({ success: false, error: "No image payload provided." });
    }

    let buffer;
    let extension = ".webp";

    if (typeof image === "string") {
      // Check if data URL
      const matches = image.match(/^data:image\/([a-zA-Z0-9+]+);base64,(.+)$/);
      if (matches) {
        const mime = matches[1].toLowerCase();
        extension = mime === "png" ? ".png" : (mime === "jpeg" || mime === "jpg") ? ".jpg" : ".webp";
        buffer = Buffer.from(matches[2], "base64");
      } else {
        // Assume raw base64
        buffer = Buffer.from(image, "base64");
      }
    } else {
      return res.status(400).json({ success: false, error: "Invalid image format. Expected base64 string." });
    }

    // Strict safety check: Reject if over 250 KB (our client compresses to <= 150 KB)
    if (buffer.length > 256 * 1024) {
      return res.status(413).json({
        success: false,
        error: `Payload too large (${(buffer.length / 1024).toFixed(1)} KB). Maximum allowed is 150 KB.`
      });
    }

    // Clean safe filename
    const safeBase = (filename || "dish_photo")
      .replace(/\.[^/.]+$/, "")
      .replace(/[^a-zA-Z0-9_-]/g, "_")
      .slice(0, 50);

    const targetFileName = `${safeBase}_${Date.now()}${extension}`;

    // Write to frontend/public/uploads/menu
    const publicPath = path.join(PUBLIC_UPLOADS_DIR, targetFileName);
    fs.writeFileSync(publicPath, buffer);

    // Also copy to frontend/dist/uploads/menu if dist exists
    try {
      if (fs.existsSync(DIST_UPLOADS_DIR)) {
        const distPath = path.join(DIST_UPLOADS_DIR, targetFileName);
        fs.writeFileSync(distPath, buffer);
      }
    } catch (e) {
      // non-fatal
    }

    const publicUrl = `/uploads/menu/${targetFileName}`;

    return res.status(200).json({
      success: true,
      url: publicUrl,
      filename: targetFileName,
      sizeBytes: buffer.length,
      sizeKB: Number((buffer.length / 1024).toFixed(1))
    });
  } catch (err) {
    console.error("[Upload API Error]:", err);
    return res.status(500).json({ success: false, error: err.message || "Failed to upload image." });
  }
}
