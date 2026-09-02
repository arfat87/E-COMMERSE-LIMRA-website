/**
 * LIMRA Restaurant - Internationalization (i18n) Module
 * Supports English (en) and Bengali / বাংলা (bn)
 */

export const translations = {
  en: {
    // Top Bar & Header
    "topbar_phone": "Call us: 097390 83418",
    "topbar_hours": "Open Daily: 11:00 AM – 10:30 PM",
    "topbar_location": "Contai - Egra Rd, Purba Medinipur, WB",
    "nav_home": "Home",
    "nav_menu": "Menu",
    "nav_about": "About",
    "nav_book": "Book a Table",
    "nav_order": "Order Online",
    "nav_gallery": "Gallery",
    "nav_reviews": "Reviews",
    "nav_contact": "Contact",
    "nav_account": "Account",
    "nav_login": "Sign In",
    "nav_cart": "Cart",
    "nav_lang_toggle": "🌐 বাংলা",

    // Hero Section
    "hero_badge": "⭐ 4.8 Rating · Authentic Culinary Delight in Egra",
    "hero_title": "Authentic Flavours & Memorable Dining in Egra",
    "hero_sub": "From fragrant biryanis to sizzling tandoori delights and mouth-watering gravies — cooked with pure love, fresh ingredients, and rich heritage spices.",
    "hero_btn_order": "🛍️ Order Online",
    "hero_btn_book": "🍽️ Book a Table",
    "hero_btn_menu": "📖 View Menu",
    "hero_stat_ratings": "500+ Happy Food Lovers",
    "hero_stat_hygiene": "100% Halal & Fresh",
    "hero_stat_delivery": "Fast Doorstep Delivery",

    // Highlights / Features
    "feature_fresh_title": "Fresh & Hygienic",
    "feature_fresh_desc": "Prepared daily with premium quality meat and fresh farm ingredients.",
    "feature_fast_title": "Superfast Delivery",
    "feature_fast_desc": "Hot & fresh food delivered directly to your home in Egra area.",
    "feature_chef_title": "Master Chefs",
    "feature_chef_desc": "Authentic recipes crafted by experienced traditional culinary chefs.",
    "feature_family_title": "Family Friendly",
    "feature_family_desc": "Spacious AC & outdoor dining ambiance for family and friends.",

    // Menu Section
    "menu_section_badge": "Our Specialties",
    "menu_section_title": "Explore Our Delicious Menu",
    "menu_section_sub": "Freshly prepared delicacies made to order. Pick your favourites or try today's specials!",
    "menu_search_placeholder": "Search dishes (e.g. Biryani, Butter Chicken, Naan)...",
    "menu_all": "All Dishes",
    "menu_specials": "⭐ Today's Specials",
    "menu_biryani": "Biryani & Rice",
    "menu_tandoori": "Tandoori & Kebabs",
    "menu_gravy": "Indian Gravy",
    "menu_bread": "Roti & Naan",
    "menu_chinese": "Chinese & Noodles",
    "menu_starters": "Starters & Snacks",
    "menu_desserts": "Desserts & Drinks",
    "btn_add": "ADD",
    "btn_added": "Added ✓",
    "btn_sold_out": "Sold Out",
    "btn_customize": "Customize",

    // Cart & Checkout
    "cart_title": "Your Order Tray",
    "cart_empty_title": "Your cart is empty",
    "cart_empty_sub": "Explore our delicious menu and add your favorite dishes to begin!",
    "cart_step1": "1. Details",
    "cart_step2": "2. Address",
    "cart_step3": "3. Payment",
    "cart_label_name": "Full Name",
    "cart_label_phone": "Phone Number (10-Digit)",
    "cart_label_email": "Email Address (Optional)",
    "cart_label_delivery_type": "Order Type",
    "cart_type_delivery": "Home Delivery",
    "cart_type_pickup": "Self Pickup (Free)",
    "cart_label_address": "Delivery Address",
    "cart_label_landmark": "Nearby Landmark (Optional)",
    "cart_label_notes": "Cooking / Delivery Instructions",
    "cart_coupon_label": "Promo Coupon",
    "cart_coupon_apply": "Apply",
    "cart_subtotal": "Subtotal",
    "cart_discount": "Promo Discount",
    "cart_delivery_charge": "Delivery Charge",
    "cart_taxes": "Taxes (5% GST Incl.)",
    "cart_total": "Grand Total",
    "cart_pay_cod": "Cash on Delivery (COD)",
    "cart_pay_online": "Pay Online — UPI / Card / NetBanking",
    "cart_pay_online_sub": "Razorpay · 100% Secure & Instant",
    "cart_btn_next": "Next Step ➔",
    "cart_btn_place_order": "🔒 Confirm & Place Order",
    "cart_btn_clear": "Clear Cart",
    "cart_trust_encrypted": "🔒 Encrypted",
    "cart_trust_instant": "✅ Instant Kitchen Notification",
    "cart_trust_support": "📞 Instant Support",

    // Order Success Modal
    "success_order_title": "Order Placed Successfully!",
    "success_order_msg": "Your order has been recorded in our system. Our chefs are preparing your food now!",
    "success_btn_receipt": "✉️ Get Email Receipt",
    "success_btn_menu": "Back to Menu",

    // Table Reservation
    "booking_section_badge": "Reserve a Table",
    "booking_section_title": "Dine-In Table Reservation",
    "booking_section_sub": "Book your table in advance for birthdays, family dinners, anniversaries, or special celebrations.",
    "booking_tab_table": "Table Booking",
    "booking_tab_birthday": "Birthday & Party",
    "booking_tab_catering": "Outdoor Catering",
    "booking_tab_status": "Check Booking Status",
    "booking_name": "Your Name",
    "booking_phone": "Phone Number",
    "booking_email": "Email Address",
    "booking_date": "Date",
    "booking_time": "Time",
    "booking_guests": "Number of Guests",
    "booking_pref": "Seating Preference",
    "booking_pref_indoor": "AC Indoor Hall",
    "booking_pref_outdoor": "Garden Outdoor",
    "booking_notes": "Special Requests / Message",
    "booking_btn_submit": "Confirm Reservation ➔",
    "booking_success_title": "Table Reserved Successfully!",
    "booking_success_msg": "Your reservation is confirmed. We look forward to hosting you at LIMRA Restaurant!",

    // Table Ordering Portal (/table/)
    "tbl_brand_sub": "Table Self-Ordering",
    "tbl_serving": "Serving Table",
    "tbl_zone_indoor": "🪑 Indoor Area",
    "tbl_zone_outdoor": "🌿 Outdoor Area",
    "tbl_search_placeholder": "Search tasty food items...",
    "tbl_specials": "⭐ Today's Specials",
    "tbl_all": "🍽️ All Items",
    "tbl_tray_title": "Your Order Tray",
    "tbl_tray_empty": "Your tray is empty",
    "tbl_tray_subtotal": "Subtotal",
    "tbl_tray_checkout": "Send Order to Kitchen",
    "tbl_modal_title": "📝 Confirm Table Order",
    "tbl_modal_name": "Your Name",
    "tbl_modal_phone": "Phone Number",
    "tbl_modal_notes": "Cooking Instructions (e.g. Less spicy)",
    "tbl_modal_coupon": "Promo Coupon Code",
    "tbl_modal_apply": "Apply",
    "tbl_modal_subtotal": "Subtotal",
    "tbl_modal_discount": "Discount",
    "tbl_modal_gst": "5% GST",
    "tbl_modal_total": "Total Payable",
    "tbl_modal_info": "This order will be automatically sent to the kitchen for your table. You can pay after dining.",
    "tbl_modal_btn_submit": "Confirm & Send to Kitchen",
    "tbl_success_title": "Order Sent to Kitchen!",
    "tbl_success_sub": "Your order has been received. Our chefs are preparing your food now.",
    "tbl_success_order_no": "Order Number:",
    "tbl_success_table": "Serving Table:",
    "tbl_success_diner": "Diner Name:",
    "tbl_success_more": "Order More Items",
    "tbl_success_review": "⭐ Google Review",

    // Language Modal
    "lang_modal_title": "Choose Your Language / ভাষা বেছে নিন",
    "lang_modal_sub": "Select your preferred language to continue / চালিয়ে যেতে আপনার পছন্দের ভাষা নির্বাচন করুন",
    "lang_modal_en_name": "English",
    "lang_modal_en_sub": "Continue in English",
    "lang_modal_bn_name": "বাংলা",
    "lang_modal_bn_sub": "বাংলা ভাষায় দেখুন ও অর্ডার করুন",
    "lang_modal_btn_continue": "Continue / এগিয়ে যান"
  },

  bn: {
    // Top Bar & Header
    "topbar_phone": "কল করুন: 097390 83418",
    "topbar_hours": "প্রতিদিন খোলা: সকাল ১১:০০ – রাত ১০:৩০",
    "topbar_location": "কাঁথি - এগরা রোড, পূর্ব মেদিনীপুর, পশ্চিমবঙ্গ",
    "nav_home": "হোম",
    "nav_menu": "মেনু",
    "nav_about": "আমাদের সম্পর্কে",
    "nav_book": "টেবিল বুকিং",
    "nav_order": "অনলাইনে অর্ডার",
    "nav_gallery": "গ্যালারি",
    "nav_reviews": "রিভিউ",
    "nav_contact": "যোগাযোগ",
    "nav_account": "অ্যাকাউন্ট",
    "nav_login": "লগইন",
    "nav_cart": "কার্ট",
    "nav_lang_toggle": "🌐 English",

    // Hero Section
    "hero_badge": "⭐ ৪.৮ রেটিং · এগরায় সেরা খাবারের নির্ভরযোগ্য ঠিকানা",
    "hero_title": "এগরায় খাঁটি ও সুস্বাদু খাবারের অতুলনীয় অভিজ্ঞতা",
    "hero_sub": "সুগন্ধি বিরিয়ানি থেকে শুরু করে গরম গরম তন্দুরি ও সুস্বাদু গ্রেভি — সেরা উপাদান এবং ঐতিহ্যবাহী মশলায় তৈরি খাঁটি খাবার।",
    "hero_btn_order": "🛍️ অনলাইনে অর্ডার করুন",
    "hero_btn_book": "🍽️ টেবিল বুক করুন",
    "hero_btn_menu": "📖 মেনু দেখুন",
    "hero_stat_ratings": "৫০০+ সন্তুষ্ট গ্রাহক",
    "hero_stat_hygiene": "১০০% হালাল ও স্বাস্থ্যকর",
    "hero_stat_delivery": "দ্রুত হোম ডেলিভারি",

    // Highlights / Features
    "feature_fresh_title": "তাজা ও স্বাস্থ্যকর",
    "feature_fresh_desc": "প্রতিদিন তাজা মাংস এবং সেরা মসলায় পরিষ্কার-পরিচ্ছন্নভাবে প্রস্তুত।",
    "feature_fast_title": "দ্রুততম ডেলিভারি",
    "feature_fast_desc": "এগরা ও পার্শ্ববর্তী এলাকায় গরম ও তাজা খাবার সরাসরি আপনার দরজায় পৌঁছে দেওয়া হয়।",
    "feature_chef_title": "অভিজ্ঞ প্রধান শেফ",
    "feature_chef_desc": "দীর্ঘ অভিজ্ঞতাসম্পন্ন দক্ষ শেফদের দ্বারা তৈরি অনন্য রান্নার স্বাদ।",
    "feature_family_title": "পারিবারিক পরিবেশ",
    "feature_family_desc": "পরিবার ও বন্ধুদের সাথে সুন্দর সময় কাটানোর জন্য এয়ার কন্ডিশনড ও আউটডোর ডাইনিং।",

    // Menu Section
    "menu_section_badge": "আমাদের বিশেষত্ব",
    "menu_section_title": "আমাদের সুস্বাদু মেনু দেখুন",
    "menu_section_sub": "অর্ডার অনুযায়ী তৈরি গরম ও তাজা খাবার। আপনার পছন্দের পদ বেছে নিন অথবা আজকের স্পেশাল ট্রাই করুন!",
    "menu_search_placeholder": "খাবার খুঁজুন (যেমন বিরিয়ানি, বাটার চিকেন, নান)...",
    "menu_all": "সব পদ",
    "menu_specials": "⭐ আজকের স্পেশাল",
    "menu_biryani": "বিরিয়ানি ও রাইস",
    "menu_tandoori": "তন্দুরি ও কাবাব",
    "menu_gravy": "ইন্ডিয়ান গ্রেভি",
    "menu_bread": "রুটি ও নান",
    "menu_chinese": "চাইনিজ ও নুডুলস",
    "menu_starters": "স্টার্টার ও স্ন্যাকস",
    "menu_desserts": "মিষ্টি ও পানীয়",
    "btn_add": "যোগ করুন",
    "btn_added": "যোগ হয়েছে ✓",
    "btn_sold_out": "স্টক শেষ",
    "btn_customize": "কাস্টমাইজ",

    // Cart & Checkout
    "cart_title": "আপনার ফুড ট্রে / কার্ট",
    "cart_empty_title": "আপনার কার্ট খালি রয়েছে",
    "cart_empty_sub": "আমাদের সুস্বাদু মেনু থেকে আপনার পছন্দের খাবার যোগ করে শুরু করুন!",
    "cart_step1": "১. তথ্য",
    "cart_step2": "২. ঠিকানা",
    "cart_step3": "৩. পেমেন্ট",
    "cart_label_name": "পুরো নাম",
    "cart_label_phone": "মোবাইল নম্বর (১০ ডিজিট)",
    "cart_label_email": "ইমেল ঠিকানা (ঐচ্ছিক)",
    "cart_label_delivery_type": "অর্ডারের ধরণ",
    "cart_type_delivery": "হোম ডেলিভারি",
    "cart_type_pickup": "সেলফ পিকআপ (ফ্রি)",
    "cart_label_address": "ডেলিভারি ঠিকানা",
    "cart_label_landmark": "নিকটবর্তী ল্যান্ডমার্ক (ঐচ্ছিক)",
    "cart_label_notes": "রান্না বা ডেলিভারির বিশেষ নির্দেশ",
    "cart_coupon_label": "প্রোমো কুপন",
    "cart_coupon_apply": "প্রয়োগ করুন",
    "cart_subtotal": "মোট মূল্য",
    "cart_discount": "কুপন ছাড়",
    "cart_delivery_charge": "ডেলিভারি চার্জ",
    "cart_taxes": "ট্যাক্স (৫% GST সহ)",
    "cart_total": "সর্বমোট প্রদেয়",
    "cart_pay_cod": "ক্যাশ অন ডেলিভারি (COD)",
    "cart_pay_online": "অনলাইন পেমেন্ট — UPI / কার্ড / নেটব্যাঙ্কিং",
    "cart_pay_online_sub": "Razorpay · ১০০% নিরাপদ ও ইনস্ট্যান্ট",
    "cart_btn_next": "পরের ধাপ ➔",
    "cart_btn_place_order": "🔒 অর্ডার নিশ্চিত করুন",
    "cart_btn_clear": "কার্ট খালি করুন",
    "cart_trust_encrypted": "🔒 সম্পূর্ণ সুরক্ষিত",
    "cart_trust_instant": "✅ তাত্ক্ষণিক রান্নাঘরে বার্তা",
    "cart_trust_support": "📞 সার্বক্ষণিক হেল্পলাইন",

    // Order Success Modal
    "success_order_title": "অর্ডার সফলভাবে গ্রহণ করা হয়েছে!",
    "success_order_msg": "আপনার অর্ডারটি আমাদের সিস্টেমে সংরক্ষিত হয়েছে। আমাদের শেফরা খাবার প্রস্তুত করা শুরু করেছেন!",
    "success_btn_receipt": "✉️ ইমেল রশিদ নিন",
    "success_btn_menu": "মেনুতে ফিরে যান",

    // Table Reservation
    "booking_section_badge": "টেবিল বুকিং",
    "booking_section_title": "ডাইনিং টেবিল রিজার্ভেশন",
    "booking_section_sub": "জন্মদিন, পারিবারিক ডিনার বা বিশেষ অনুষ্ঠানের জন্য আগে থেকেই টেবিল বুক করে রাখুন।",
    "booking_tab_table": "টেবিল বুকিং",
    "booking_tab_birthday": "জন্মদিন ও পার্টি",
    "booking_tab_catering": "আউটডোর ক্যাটারিং",
    "booking_tab_status": "বুকিং স্ট্যাটাস দেখুন",
    "booking_name": "আপনার নাম",
    "booking_phone": "মোবাইল নম্বর",
    "booking_email": "ইমেল ঠিকানা",
    "booking_date": "তারিখ",
    "booking_time": "সময়",
    "booking_guests": "অতিথি সংখ্যা",
    "booking_pref": "বসার পছন্দ",
    "booking_pref_indoor": "এসি ইনডোর হল",
    "booking_pref_outdoor": "গার্ডেন আউটডোর",
    "booking_notes": "বিশেষ অনুরোধ / বার্তা",
    "booking_btn_submit": "রিজার্ভেশন নিশ্চিত করুন ➔",
    "booking_success_title": "টেবিল রিজার্ভেশন সফল হয়েছে!",
    "booking_success_msg": "আপনার টেবিল বুকিং সফল হয়েছে। লিমরা রেস্তোরাঁয় আপনার আগমন সানন্দে প্রতীক্ষিত!",

    // Table Ordering Portal (/table/)
    "tbl_brand_sub": "টেবিল সেলফ-অর্ডারিং",
    "tbl_serving": "সার্ভিং টেবিল",
    "tbl_zone_indoor": "🪑 ইনডোর এলাকা",
    "tbl_zone_outdoor": "🌿 আউটডোর এলাকা",
    "tbl_search_placeholder": "সুস্বাদু খাবার খুঁজুন...",
    "tbl_specials": "⭐ আজকের স্পেশাল",
    "tbl_all": "🍽️ সব পদ",
    "tbl_tray_title": "আপনার অর্ডারের ট্রে",
    "tbl_tray_empty": "আপনার ট্রে খালি রয়েছে",
    "tbl_tray_subtotal": "মোট মূল্য",
    "tbl_tray_checkout": "রান্নাঘরে অর্ডার পাঠান",
    "tbl_modal_title": "📝 টেবিল অর্ডার নিশ্চিত করুন",
    "tbl_modal_name": "আপনার নাম",
    "tbl_modal_phone": "মোবাইল নম্বর",
    "tbl_modal_notes": "রান্নার নির্দেশিকা (যেমন: ঝাল কম, পেঁয়াজ ছাড়া)",
    "tbl_modal_coupon": "প্রোমো কুপন কোড",
    "tbl_modal_apply": "প্রয়োগ করুন",
    "tbl_modal_subtotal": "মোট মূল্য",
    "tbl_modal_discount": "ছাড়",
    "tbl_modal_gst": "৫% GST",
    "tbl_modal_total": "সর্বমোট বিল",
    "tbl_modal_info": "এই অর্ডারটি সরাসরি আপনার টেবিলের জন্য রান্নাঘরে পৌঁছে যাবে। খাবার পর আপনি বিল পরিশোধ করতে পারেন।",
    "tbl_modal_btn_submit": "নিশ্চিত করে রান্নাঘরে পাঠান",
    "tbl_success_title": "অর্ডার রান্নাঘরে পৌঁছে গেছে!",
    "tbl_success_sub": "আপনার অর্ডার গৃহীত হয়েছে। আমাদের শেফরা আপনার খাবার তৈরি করছেন।",
    "tbl_success_order_no": "অর্ডার নম্বর:",
    "tbl_success_table": "টেবিল নম্বর:",
    "tbl_success_diner": "গ্রাহকের নাম:",
    "tbl_success_more": "আরও খাবার অর্ডার করুন",
    "tbl_success_review": "⭐ গুগল রিভিউ দিন",

    // Language Modal
    "lang_modal_title": "ভাষা নির্বাচন করুন / Choose Your Language",
    "lang_modal_sub": "চালিয়ে যেতে আপনার পছন্দের ভাষা বেছে নিন / Select language to continue",
    "lang_modal_en_name": "English",
    "lang_modal_en_sub": "ইংরেজি ভাষায় দেখুন",
    "lang_modal_bn_name": "বাংলা",
    "lang_modal_bn_sub": "বাংলা ভাষায় ব্রাউজ ও অর্ডার করুন",
    "lang_modal_btn_continue": "এগিয়ে যান / Continue"
  }
};

const STORAGE_KEY = 'limra_language';
let currentLang = 'en';

export function getLanguage() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'bn' || saved === 'en') return saved;
  } catch (e) {}
  return 'en';
}

export function t(key, lang = currentLang) {
  const dict = translations[lang] || translations.en;
  return dict[key] || translations.en[key] || key;
}

export function setLanguage(lang) {
  if (lang !== 'en' && lang !== 'bn') lang = 'en';
  currentLang = lang;
  try {
    localStorage.setItem(STORAGE_KEY, lang);
    localStorage.setItem('limra_lang_chosen', 'true');
  } catch (e) {}

  document.documentElement.lang = lang === 'bn' ? 'bn-IN' : 'en-IN';
  applyTranslations();

  window.dispatchEvent(new CustomEvent('limra_language_changed', { detail: { lang } }));
  updateToggleButtons();
}

export function applyTranslations() {
  const elements = document.querySelectorAll('[data-i18n]');
  elements.forEach(el => {
    const key = el.getAttribute('data-i18n');
    if (key) {
      const text = t(key);
      if (text) {
        if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
          if (el.type === 'button' || el.type === 'submit') {
            el.value = text;
          }
        } else {
          el.textContent = text;
        }
      }
    }
  });

  const placeholders = document.querySelectorAll('[data-i18n-placeholder]');
  placeholders.forEach(el => {
    const key = el.getAttribute('data-i18n-placeholder');
    if (key) {
      const text = t(key);
      if (text) el.placeholder = text;
    }
  });

  updateToggleButtons();
}

function updateToggleButtons() {
  const toggleBtns = document.querySelectorAll('.limra-lang-toggle-btn');
  toggleBtns.forEach(btn => {
    btn.innerHTML = currentLang === 'bn' ? '🌐 English' : '🌐 বাংলা';
    btn.setAttribute('title', currentLang === 'bn' ? 'Switch to English' : 'বাংলা ভাষায় পরিবর্তন করুন');
  });
}

/**
 * Checks if user has previously chosen a language. If not, displays the Language Selection Popup Modal.
 */
export function initLanguageSystem() {
  currentLang = getLanguage();
  document.documentElement.lang = currentLang === 'bn' ? 'bn-IN' : 'en-IN';
  applyTranslations();
  setupLanguageModalEvents();

  // Attach click listener to all language toggle buttons
  document.querySelectorAll('.limra-lang-toggle-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      openLanguageModal();
    });
  });

  // Check if popup should be shown on initial page entry
  let hasChosen = false;
  try {
    hasChosen = localStorage.getItem('limra_lang_chosen') === 'true';
  } catch (e) {}

  if (!hasChosen) {
    // Show modal after slight delay for smooth aesthetic entrance
    setTimeout(() => {
      openLanguageModal();
    }, 400);
  }
}

export function openLanguageModal() {
  const modal = document.getElementById('language-selection-modal');
  if (!modal) return;
  modal.classList.remove('hidden', 'opacity-0', 'pointer-events-none');
  modal.classList.add('flex');
}

export function closeLanguageModal() {
  const modal = document.getElementById('language-selection-modal');
  if (!modal) return;
  modal.classList.add('opacity-0', 'pointer-events-none');
  setTimeout(() => {
    modal.classList.add('hidden');
    modal.classList.remove('flex');
  }, 250);
}

export function setupLanguageModalEvents() {
  const modal = document.getElementById('language-selection-modal');
  if (!modal) return;

  const cardBn = document.getElementById('lang-card-bn');
  const cardEn = document.getElementById('lang-card-en');
  const closeBtn = document.getElementById('lang-modal-close-btn');

  if (cardBn) {
    cardBn.onclick = () => {
      setLanguage('bn');
      closeLanguageModal();
    };
  }

  if (cardEn) {
    cardEn.onclick = () => {
      setLanguage('en');
      closeLanguageModal();
    };
  }

  if (closeBtn) {
    closeBtn.onclick = () => {
      try { localStorage.setItem('limra_lang_chosen', 'true'); } catch (e) {}
      closeLanguageModal();
    };
  }

  modal.onclick = (e) => {
    if (e.target === modal) {
      try { localStorage.setItem('limra_lang_chosen', 'true'); } catch (e) {}
      closeLanguageModal();
    }
  };
}
