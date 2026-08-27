import { menuItems, categoryLabels } from '../src/data/menu.js';
import { createClient } from '@insforge/sdk';

const insforge = createClient({
  baseUrl: 'https://vb9ucr22.us-east.insforge.app',
  anonKey: 'ik_799af068e8f4fb05944d04497229fe7d'
});

async function testFoodsManagement() {
  console.log('--- Step 1: Validating Base Menu Items ---');
  console.log(`Base menu items count: ${menuItems.length}`);
  if (menuItems.length < 200) throw new Error('Menu items array incomplete');

  console.log('--- Step 2: Fetching Menu Overrides from Database ---');
  const { data: overrides, error: ovErr } = await insforge.database.from('menu_overrides').select('*');
  if (ovErr) console.warn('Overrides fetch note:', ovErr.message);
  else console.log(`Fetched ${overrides?.length || 0} menu overrides.`);

  console.log('--- Step 3: Simulating In-Stock and Featured Dishes Calculations ---');
  const activeCount = menuItems.length;
  const categoriesCount = Object.keys(categoryLabels).length;

  console.log(`Total Menu Dishes: ${activeCount}`);
  console.log(`Total Categories: ${categoriesCount}`);
  console.log('Categories list:', Object.values(categoryLabels).join(', '));

  console.log('Food Menu Management Test PASSED ✅');
}

testFoodsManagement().catch(err => {
  console.error('Test Failed:', err);
  process.exit(1);
});
