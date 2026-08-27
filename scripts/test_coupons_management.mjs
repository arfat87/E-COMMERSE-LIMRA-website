import { createClient } from '@insforge/sdk';

const insforge = createClient({
  baseUrl: 'https://vb9ucr22.us-east.insforge.app',
  anonKey: 'ik_799af068e8f4fb05944d04497229fe7d'
});

async function testCouponsManagement() {
  console.log('--- Step 1: Fetching Coupons from InsForge BaaS ---');
  const { data: coupons, error } = await insforge.database.from('coupons').select('*');
  if (error) {
    console.warn('Note on fetching coupons:', error.message);
  } else {
    console.log(`Successfully fetched ${coupons?.length || 0} coupons from database.`);
  }

  console.log('--- Step 2: Testing Aggregation Metrics on Sample Data ---');
  const now = new Date();
  const sampleCoupons = [
    { code: 'WELCOME10', discount_pct: 10, min_bill: 200, used_count: 45, max_uses: 100, expiry_date: new Date(now.getTime() + 864000000).toISOString(), active: true },
    { code: 'BIRYANIFEST', discount_pct: 20, min_bill: 500, used_count: 18, max_uses: 50, expiry_date: new Date(now.getTime() + 864000000).toISOString(), active: true },
    { code: 'EXPIRED15', discount_pct: 15, min_bill: 300, used_count: 50, max_uses: 50, expiry_date: new Date(now.getTime() - 864000000).toISOString(), active: true }
  ];

  const activeCoupons = sampleCoupons.filter(c => c.active && new Date(c.expiry_date) >= now && c.used_count < c.max_uses).length;
  const totalRedemptions = sampleCoupons.reduce((s, c) => s + c.used_count, 0);
  
  let topCode = '';
  let maxUses = 0;
  sampleCoupons.forEach(c => {
    if (c.used_count > maxUses) {
      maxUses = c.used_count;
      topCode = c.code;
    }
  });

  console.log(`Active Coupons: ${activeCoupons}`);
  console.log(`Total Redemptions: ${totalRedemptions}`);
  console.log(`Top Code: ${topCode}`);

  if (activeCoupons !== 2 || totalRedemptions !== 113 || topCode !== 'EXPIRED15') {
    throw new Error('Coupons aggregation logic mismatch');
  }

  console.log('Coupons Management Test PASSED ✅');
}

testCouponsManagement().catch(err => {
  console.error('Test Failed:', err);
  process.exit(1);
});
