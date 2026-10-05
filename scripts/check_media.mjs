import fs from "fs";

const content = fs.readFileSync("C:/Users/salim/.gemini/antigravity/brain/9a7e32ef-c2ae-4789-b482-9dcb09df228f/.system_generated/logs/transcript_full.jsonl", "utf8");
const lines = content.trim().split("\n");
const d = JSON.parse(lines[35]);
console.log("Media in line 35:", JSON.stringify(d.media, null, 2));
