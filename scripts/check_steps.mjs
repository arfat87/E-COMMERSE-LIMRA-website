import fs from "fs";

const content = fs.readFileSync("C:/Users/salim/.gemini/antigravity/brain/9a7e32ef-c2ae-4789-b482-9dcb09df228f/.system_generated/logs/transcript_full.jsonl", "utf8");
const lines = content.trim().split("\n");

console.log("Total lines:", lines.length);
for (let i = 30; i < Math.min(lines.length, 45); i++) {
  try {
    const d = JSON.parse(lines[i]);
    console.log(`Line ${i}: type=${d.type}, keys=${Object.keys(d).join(',')}, contentLen=${(d.content || '').length}`);
    if (d.type === 'USER_INPUT') {
      console.log(`Content snippet: ${(d.content || '').slice(0, 100)}`);
    }
  } catch(e) {}
}
