import { createClient } from "@insforge/sdk";

const client = createClient({
  baseUrl: "https://vb9ucr22.us-east.insforge.app",
  anonKey: "ik_799af068e8f4fb05944d04497229fe7d",
});

async function test() {
  console.log("Fetching printer_settings...");
  const { data, error } = await client.database
    .from("printer_settings")
    .select("*")
    .eq("id", "default")
    .single();

  if (error) {
    console.error("Error fetching printer_settings:", error);
  } else {
    console.log("Fetched printer_settings successfully:", data);
  }
}

test().catch(console.error);
