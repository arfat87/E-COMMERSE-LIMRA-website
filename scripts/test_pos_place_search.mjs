async function testPosPlaceSearch() {
  console.log('--- Testing POS Place Search & Auto Delivery Fee Logic ---');

  const mockAdminPlaces = [
    { id: 1, name: 'Contai Central', charge: 30 },
    { id: 2, name: 'Marishda Village', charge: 50 },
    { id: 3, name: 'Nachinda Market', charge: 70 },
    { id: 4, name: 'Kanthi Railway Station', charge: 40 },
    { id: 5, name: 'Egra Town', charge: 35 }
  ];

  // 1. Search place function
  function searchPlaces(query) {
    const q = (query || '').toLowerCase().trim();
    if (!q) return [];
    return mockAdminPlaces.filter(p => p.name.toLowerCase().includes(q));
  }

  const matches = searchPlaces('marish');
  console.log('Search "marish":', matches);
  if (matches.length !== 1 || matches[0].name !== 'Marishda Village') {
    throw new Error('Search failed to find Marishda Village');
  }

  // 2. Select Place & auto-fill charge
  let posSelectedPlace = null;
  let posDeliveryFee = 0;
  function selectPosPlace(place) {
    posSelectedPlace = place;
    posDeliveryFee = place.charge;
  }

  selectPosPlace(matches[0]);
  console.log(`Selected Place: ${posSelectedPlace.name}, Auto Delivery Fee: ₹${posDeliveryFee}`);
  if (posDeliveryFee !== 50 || posSelectedPlace.name !== 'Marishda Village') {
    throw new Error('Auto delivery fee failed');
  }

  // 3. Construct Delivery Address with Landmark
  const specificLandmark = 'Near Bus Stand, House #42';
  const fullAddress = `${posSelectedPlace.name} - ${specificLandmark}`;
  console.log('Formatted Delivery Address:', fullAddress);
  if (!fullAddress.includes('Marishda Village') || !fullAddress.includes(specificLandmark)) {
    throw new Error('Full address formatting failed');
  }

  // 4. Clear Place
  function clearPosPlace() {
    posSelectedPlace = null;
    posDeliveryFee = 0;
  }
  clearPosPlace();
  console.log('After Clear -> Place:', posSelectedPlace, 'Fee:', posDeliveryFee);
  if (posSelectedPlace !== null || posDeliveryFee !== 0) {
    throw new Error('Clear place failed');
  }

  console.log('POS Place Search & Auto Delivery Fee Tests PASSED ✅');
}

testPosPlaceSearch().catch(err => {
  console.error('Test Failed:', err);
  process.exit(1);
});
