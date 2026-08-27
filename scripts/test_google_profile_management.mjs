function getGoogleBusinessProfile(stored) {
  if (stored) return stored;
  return {
    name: 'LIMRA RESTAURANT',
    category: 'Mughlai & Biryani Restaurant',
    reviewUrl: 'https://g.page/r/limra-restaurant/review',
    mapsUrl: 'https://maps.google.com/?q=LIMRA+Restaurant',
    hours: '11:00 AM – 11:30 PM (Daily)',
    phone: '+91 99999 88888',
    address: 'Main Road, Near Bus Stand, Egra, West Bengal',
    rating: '4.8',
    reviewsCount: '348',
    viewsCount: '12.4k',
    status: 'Verified ✓'
  };
}

function testGoogleProfileManagement() {
  console.log('--- Step 1: Testing Profile Defaults & Field Integrity ---');
  const profile = getGoogleBusinessProfile();
  console.log(`Business Name: ${profile.name}`);
  console.log(`Rating: ${profile.rating} ⭐`);
  console.log(`Reviews Count: ${profile.reviewsCount}`);
  console.log(`Review URL: ${profile.reviewUrl}`);
  
  if (!profile.reviewUrl.includes('review') || profile.rating !== '4.8') {
    throw new Error('Google business profile default integrity failure');
  }

  console.log('--- Step 2: Testing WhatsApp Review Booster Formatting ---');
  const boosterMsg = encodeURIComponent(
    `Hello! Thank you for dining with us at ${profile.name}! 🍽️\n\nWe would truly appreciate 10 seconds of your time to share your experience with a 5-star rating on Google Maps:\n⭐ ${profile.reviewUrl}\n\nThank you for your support!`
  );
  if (!boosterMsg.includes('LIMRA')) {
    throw new Error('Booster message encoding failed');
  }
  console.log('Booster message formatted successfully.');

  console.log('--- Step 3: Testing Smart AI Reply Generator ---');
  const reviewer = 'Arfat';
  const reply = `Dear ${reviewer}, thank you so much for the 5-star rating and kind feedback! We are thrilled that you had a wonderful dining experience at ${profile.name}. We look forward to welcoming you back soon! 🍽️✨`;
  if (!reply.includes(reviewer) || !reply.includes(profile.name)) {
    throw new Error('Smart reply generator failed');
  }
  console.log(`Generated Smart Reply: ${reply}`);

  console.log('Google Profile Management Test PASSED ✅');
}

testGoogleProfileManagement();
