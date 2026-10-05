import fs from "fs";

const content = fs.readFileSync("scripts/september_orders.csv", "utf8");
const lines = content.trim().split("\n");
const header = lines[0];

function parseLine(line) {
  const result = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') inQ = !inQ;
    else if (c === ',' && !inQ) {
      result.push(cur.trim());
      cur = "";
    } else {
      cur += c;
    }
  }
  result.push(cur.trim());
  return result;
}

const types = new Set();
const statuses = new Set();
const payStatuses = new Set();
const payModes = new Set();
let validRows = 0;

for (let i = 1; i < lines.length; i++) {
  const line = lines[i].trim();
  if (!line) continue;
  const cols = parseLine(line);
  if (cols.length >= 10) {
    validRows++;
    types.add(cols[4]);
    statuses.add(cols[6]);
    payStatuses.add(cols[7]);
    payModes.add(cols[8]);
  } else {
    console.warn(`Line ${i + 1} has ${cols.length} cols:`, line);
  }
}

console.log("Valid Rows:", validRows);
console.log("Order Types:", [...types]);
console.log("Statuses:", [...statuses]);
console.log("Payment Statuses:", [...payStatuses]);
console.log("Payment Modes:", [...payModes]);
