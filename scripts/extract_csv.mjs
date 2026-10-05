import fs from "fs";
import readline from "readline";

const logPath = "C:/Users/salim/.gemini/antigravity/brain/9a7e32ef-c2ae-4789-b482-9dcb09df228f/.system_generated/logs/transcript_full.jsonl";

async function extract() {
  const fileStream = fs.createReadStream(logPath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  for await (const line of rl) {
    if (line.includes('"USER_INPUT"') && line.includes('Order Number,Date & Time')) {
      const parsed = JSON.parse(line);
      const content = parsed.content || "";
      const csvIdx = content.indexOf("Order Number,Date & Time");
      if (csvIdx !== -1) {
        const csvText = content.slice(csvIdx);
        fs.writeFileSync("scripts/september_orders.csv", csvText);
        console.log("Successfully extracted CSV! Length:", csvText.length, "Lines:", csvText.split("\n").length);
        return;
      }
    }
  }
  console.log("Not found with USER_INPUT");
}

extract().catch(console.error);
