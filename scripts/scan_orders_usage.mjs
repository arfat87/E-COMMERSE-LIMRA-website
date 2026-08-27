import fs from "fs";
import path from "path";

function scanDir(dir) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const full = path.join(dir, file);
    if (fs.statSync(full).isDirectory()) {
      if (file !== "node_modules" && file !== "dist" && file !== ".git") {
        scanDir(full);
      }
    } else if (file.endsWith(".js") || file.endsWith(".mjs") || file.endsWith(".ts")) {
      const content = fs.readFileSync(full, "utf8");
      if (content.includes("from('orders')")) {
        console.log(`=== File: ${full} ===`);
        const lines = content.split("\n");
        lines.forEach((l, idx) => {
          if (l.includes("from('orders')")) {
            console.log(`  Line ${idx+1}: ${l.trim()}`);
          }
        });
      }
    }
  }
}

scanDir("src");
