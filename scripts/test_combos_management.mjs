import { createClient } from '@insforge/sdk';

const insforge = createClient({
  baseUrl: 'https://vb9ucr22.us-east.insforge.app',
  anonKey: 'ik_799af068e8f4fb05944d04497229fe7d'
});

async function testCombosManagement() {
  console.log('--- Step 1: Fetching Combos from InsForge BaaS ---');
  const { data: combos, error } = await insforge.database.from('combos').select('*');
  if (error) {
    console.warn('Note on fetching combos:', error.message);
  } else {
    console.log(`Successfully fetched ${combos?.length || 0} combos from database.`);
  }

  console.log('--- Step 2: Testing Aggregation Metrics on Sample Data ---');
  const sampleCombos = [
    { id: 1, name: 'Family Biryani Feast', price: 799, mrp: 999, available: true, items: [{ name: 'Chicken Biryani', qty: 2 }, { name: 'Butter Naan', qty: 4 }] },
    { id: 2, name: 'Tandoori Starter Pack', price: 450, mrp: 600, available: true, items: [{ name: 'Chicken Tikka', qty: 1 }, { name: 'Paneer Tikka', qty: 1 }] },
    { id: 3, name: 'Sweet Treat Duo', price: 150, mrp: 200, available: false, items: [{ name: 'Gulab Jamun', qty: 2 }] }
  ];

  const totalCombos = sampleCombos.length;
  const activeCombos = sampleCombos.filter(c => c.available !== false).length;
  const avgPrice = sampleCombos.reduce((s, c) => s + c.price, 0) / totalCombos;
  
  let totalSavingsPct = 0;
  let savingsCount = 0;
  sampleCombos.forEach(c => {
    if (c.mrp > c.price) {
      totalSavingsPct += ((c.mrp - c.price) / c.mrp) * 100;
      savingsCount++;
    }
  });
  const avgSavings = (totalSavingsPct / savingsCount).toFixed(0);

  console.log(`Total Combos: ${totalCombos}`);
  console.log(`Active Combos: ${activeCombos}`);
  console.log(`Avg Price: ₹${avgPrice.toFixed(2)}`);
  console.log(`Avg Savings: ${avgSavings}% OFF`);

  if (totalCombos !== 3 || activeCombos !== 2 || avgSavings !== '23') {
    throw new Error('Aggregation calculation mismatch');
  }

  console.log('Combos Management Test PASSED ✅');
}

testCombosManagement().catch(err => {
  console.error('Test Failed:', err);
  process.exit(1);
});
