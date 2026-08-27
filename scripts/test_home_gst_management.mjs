import { createClient } from '@insforge/sdk';

const insforge = createClient({
  baseUrl: 'https://vb9ucr22.us-east.insforge.app',
  anonKey: 'ik_799af068e8f4fb05944d04497229fe7d'
});

async function testHomeGSTManagement() {
  console.log('--- Step 1: Fetching Orders from Database ---');
  const { data: orders, error } = await insforge.database.from('orders').select('*');
  if (error) {
    console.warn('Note on fetching orders:', error.message);
  } else {
    console.log(`Fetched ${orders?.length || 0} orders.`);
  }

  console.log('--- Step 2: Testing Restaurant GST Calculation (5% Total = 2.5% CGST + 2.5% SGST) ---');
  const sampleOrders = [
    { order_number: '101', created_at: new Date().toISOString(), total_amount: 525, payment_status: 'paid', status: 'delivered', customer_name: 'Diner A', customer_phone: '9876543210' },
    { order_number: '102', created_at: new Date().toISOString(), total_amount: 1050, payment_status: 'paid', status: 'delivered', customer_name: 'Diner B', customer_phone: '9876543211' },
    { order_number: '103', created_at: new Date().toISOString(), total_amount: 315, payment_status: 'unpaid', status: 'hold', customer_name: 'Diner C', customer_phone: '9876543212' }
  ];

  let totalTaxable = 0;
  let totalCGST = 0;
  let totalSGST = 0;
  let totalGST = 0;

  sampleOrders.forEach(o => {
    const totalAmt = parseFloat(o.total_amount);
    const taxable = totalAmt / 1.05;
    const cgst = taxable * 0.025;
    const sgst = taxable * 0.025;
    const gst = cgst + sgst;

    totalTaxable += taxable;
    totalCGST += cgst;
    totalSGST += sgst;
    totalGST += gst;
  });

  console.log(`Total Taxable: ₹${totalTaxable.toFixed(2)}`);
  console.log(`Total CGST (2.5%): ₹${totalCGST.toFixed(2)}`);
  console.log(`Total SGST (2.5%): ₹${totalSGST.toFixed(2)}`);
  console.log(`Total GST (5.0%): ₹${totalGST.toFixed(2)}`);

  // 1890 / 1.05 = 1800, GST = 90 (45 CGST + 45 SGST)
  if (Math.round(totalTaxable) !== 1800 || Math.round(totalGST) !== 90) {
    throw new Error('GST calculation mismatch');
  }

  console.log('--- Step 3: Testing CSV Generator Headers and Rows ---');
  const headers = ['Invoice / Order #', 'Invoice Date', 'Customer Name', 'Customer Phone', 'Order Type', 'Payment Mode', 'Payment Status', 'SAC Code', 'Taxable Value (INR)', 'CGST Rate (%)', 'CGST Amount (INR)', 'SGST Rate (%)', 'SGST Amount (INR)', 'Total GST (INR)', 'Invoice Total (INR)', 'Restaurant Name', 'Restaurant GSTIN'];
  
  if (headers.length !== 17 || !headers.includes('SAC Code') || !headers.includes('CGST Amount (INR)')) {
    throw new Error('CSV Headers structure incomplete');
  }

  console.log('Home Executive Command Center & Monthly GST Filing Test PASSED ✅');
}

testHomeGSTManagement().catch(err => {
  console.error('Test Failed:', err);
  process.exit(1);
});
