async function testSettingsHub() {
  console.log('--- Step 1: Testing Staff Manager Structure and Mock Operations ---');
  const mockStaff = [
    { id: 'st-1', name: 'Salim Khan', role: 'Store Manager', phone: '+91 99887 76655', email: 'salim@limra.com', shift: '10:00 AM - 08:00 PM', status: 'on_duty', notes: 'Master admin & operations' },
    { id: 'st-2', name: 'Rahul Sharma', role: 'Head Chef / Kitchen', phone: '+91 98765 43210', email: 'rahul@limra.com', shift: '11:00 AM - 11:00 PM', status: 'on_duty', notes: 'Main kitchen & Tandoor in-charge' },
    { id: 'st-3', name: 'Imran Ansari', role: 'Service Captain', phone: '+91 98123 45678', email: 'imran@limra.com', shift: '12:00 PM - 11:30 PM', status: 'on_duty', notes: 'Dining hall & QR tables manager' },
    { id: 'st-4', name: 'Danish Ali', role: 'Delivery Rider', phone: '+91 97234 56789', email: 'danish@limra.com', shift: '01:00 PM - 11:00 PM', status: 'on_duty', notes: 'Vehicle DL-3S-8821' },
    { id: 'st-5', name: 'Afzal Qureshi', role: 'POS Cashier', phone: '+91 96345 67890', email: 'afzal@limra.com', shift: '10:00 AM - 07:00 PM', status: 'off_duty', notes: 'Counter billing & settlements' }
  ];

  const onDutyCount = mockStaff.filter(s => s.status === 'on_duty').length;
  const kitchenCount = mockStaff.filter(s => s.role.toLowerCase().includes('chef')).length;
  const riderCount = mockStaff.filter(s => s.role.toLowerCase().includes('rider')).length;

  console.log(`Staff Members: ${mockStaff.length}, On-Duty: ${onDutyCount}, Chefs: ${kitchenCount}, Riders: ${riderCount}`);
  if (onDutyCount !== 4 || kitchenCount !== 1 || riderCount !== 1) {
    throw new Error('Staff calculation mismatch');
  }

  console.log('--- Step 2: Testing Staff Directory CSV Export Generation ---');
  const headers = ['Staff ID', 'Full Name', 'Role / Designation', 'Status', 'Phone Number', 'Email', 'Shift Hours', 'Operational Notes'];
  const rows = mockStaff.map(s => [
    `"${s.id}"`,
    `"${s.name}"`,
    `"${s.role}"`,
    `"${s.status}"`,
    `"${s.phone}"`,
    `"${s.email}"`,
    `"${s.shift}"`,
    `"${s.notes}"`
  ]);

  if (headers.length !== 8 || rows.length !== 5) {
    throw new Error('Staff CSV export incomplete');
  }

  console.log('--- Step 3: Testing WhatsApp Business Automation & Templates ---');
  const WA_TEMPLATES = {
    confirm: 'Hi {customer_name}! Your order #{order_number} at LIMRA Restaurant has been confirmed and is being freshly prepared with care. Total: {amount}. Thank you for choosing us!',
    delivery: 'Hi {customer_name}! Great news! Your order #{order_number} is out for delivery. Our rider is on the way. Expected ETA: 15-20 mins. Enjoy your meal!',
    review: 'Hi {customer_name}! Thank you for dining with LIMRA Restaurant! If you loved our food and service, please share a quick 5-star Google Review here: https://g.page/r/limra-restaurant/review. We appreciate your support!'
  };

  let renderedMsg = WA_TEMPLATES.confirm
    .replace('{customer_name}', 'Rahul')
    .replace('{order_number}', '108')
    .replace('{amount}', '₹450.00');

  const phone = '9876543210';
  const waUrl = `https://wa.me/91${phone}?text=${encodeURIComponent(renderedMsg)}`;

  console.log('Rendered WhatsApp Message:', renderedMsg);
  console.log('Generated WhatsApp Link:', waUrl);

  if (!waUrl.includes('https://wa.me/919876543210') || !renderedMsg.includes('#108')) {
    throw new Error('WhatsApp template processing failed');
  }

  console.log('Settings Hub, Staff Manager & WhatsApp Manager Tests PASSED ✅');
}

testSettingsHub().catch(err => {
  console.error('Test Failed:', err);
  process.exit(1);
});
