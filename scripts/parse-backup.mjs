import fs from "fs";
import readline from "readline";

const filePath = "C:\\Users\\salim\\Downloads\\20260901_170632.sql\\20260901_170632.sql";
const fileStream = fs.createReadStream(filePath);
const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

const tableCols = {};

rl.on("line", (line) => {
  if (line.startsWith("COPY public.")) {
    const match = line.match(/^COPY public\.([a-zA-Z0-9_]+)\s*\(([^)]+)\)\s+FROM stdin;/);
    if (match) {
      tableCols[match[1]] = match[2].split(",").map((c) => c.trim());
    }
  }
  if (line.startsWith("COPY auth.")) {
    const match = line.match(/^COPY auth\.([a-zA-Z0-9_]+)\s*\(([^)]+)\)\s+FROM stdin;/);
    if (match) {
      tableCols["auth." + match[1]] = match[2].split(",").map((c) => c.trim());
    }
  }
});

rl.on("close", () => {
  console.log("=== TABLE COLUMNS IN BACKUP ===");
  for (const [tbl, cols] of Object.entries(tableCols)) {
    console.log(`- ${tbl}: [${cols.join(", ")}]`);
  }
});
