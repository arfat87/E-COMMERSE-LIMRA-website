import { createClient } from "@insforge/sdk";

const client = createClient({
  baseUrl: "https://vb9ucr22.us-east.insforge.app",
  anonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3OC0xMjM0LTU2NzgtOTBhYi1jZGVmMTIzNDU2NzgiLCJlbWFpbCI6ImFub25AaW5zZm9yZ2UuY29tIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAwNzQ3MjZ9.CORVtgdxoKKq0AhdUN0RY8s1h3jHMUF3ZOB0CpmnoYk"
});

async function check() {
  const { data: items } = await client.database.from("stock_items").select("*");
  const { data: inEntries } = await client.database.from("stock_in").select("*");
  const { data: outEntries } = await client.database.from("stock_out").select("*");

  console.log("Comparing calculated balance vs stored qty:");
  for (const item of items.slice(0, 15)) {
    const totalIn = inEntries
      .filter(e => (e.item_sku === item.sku || e.item_id === item.id))
      .reduce((s, e) => s + parseFloat(e.qty || 0), 0);
    const totalOut = outEntries
      .filter(e => (e.item_sku === item.sku || e.item_id === item.id))
      .reduce((s, e) => s + parseFloat(e.qty || 0), 0);
    const calcBal = parseFloat((totalIn - totalOut).toFixed(2));
    console.log(`SKU: ${item.sku.padEnd(6)} | Name: ${item.name.padEnd(28)} | Total IN: ${String(totalIn).padEnd(6)} | Total OUT: ${String(totalOut).padEnd(6)} | Calc Bal: ${String(calcBal).padEnd(6)} | Stored Qty: ${item.qty}`);
  }
}

check().catch(console.error);
