import fs from "fs";
import readline from "readline";

const logPath = "C:/Users/salim/.gemini/antigravity/brain/9a7e32ef-c2ae-4789-b482-9dcb09df228f/.system_generated/logs/transcript_full.jsonl";

async function inspect() {
  const fileStream = fs.createReadStream(logPath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  let lineNo = 0;
  for await (const line of rl) {
    lineNo++;
    if (line.includes("7363975172")) {
      const parsed = JSON.parse(line);
      console.log(`Found on line ${lineNo}: type=${parsed.type}, source=${parsed.source}, contentLen=${(parsed.content || '').length}`);
      if (parsed.content) {
        const csvIdx = parsed.content.indexOf("Order Number,Date & Time");
        if (csvIdx !== -1) {
          const csvText = parsed.content.slice(csvIdx);
          fs.writeFileSync("scripts/september_orders.csv", csvText);
          console.log("Successfully extracted! Lines:", csvText.split("\n").length);
          return;
        }
      }
    }
  }
}

inspect().catch(console.error);
