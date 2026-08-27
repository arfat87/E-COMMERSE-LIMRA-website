import { writeFileSync } from 'fs';

const categoryImages = {
  soup: '/images/food_soup.png',
  'veg-starters': '/images/food_starters.png',
  'nonveg-starters': '/images/food_starters.png',
  'tandoor-kabab': '/images/food_kababs.png',
  bread: '/images/food_naan.png',
  biryani: '/images/food_biryani.png',
  'veg-curry': '/images/food_dal.png',
  'nonveg-curry': '/images/food_gravy_chicken.png',
  'veg-rice': '/images/food_fried_rice.png',
  'nonveg-rice': '/images/food_fried_rice.png',
  'chinese-veg': '/images/food_chinese.png',
  'chinese-nonveg': '/images/food_chinese.png',
  noodles: '/images/food_noodles.png',
  thali: '/images/food_biryani.png',
  desserts: '/images/food_tea.png',
  salads: '/images/food_starters.png',
  'momos-chaat': '/images/food_chinese.png',
  juices: '/images/food_tea.png',
  lassi: '/images/food_tea.png',
  milkshakes: '/images/food_tea.png',
  mocktails: '/images/food_tea.png',
  beverages: '/images/food_tea.png',
};

const categoryEmojis = {
  soup: '🍲',
  'veg-starters': '🥗',
  'nonveg-starters': '🍗',
  'tandoor-kabab': '🔥',
  bread: '🫓',
  biryani: '🍚',
  'veg-curry': '🥘',
  'nonveg-curry': '🍛',
  'veg-rice': '🍳',
  'nonveg-rice': '🍳',
  'chinese-veg': '🍜',
  'chinese-nonveg': '🍜',
  noodles: '🍝',
  thali: '🍽️',
  desserts: '🍨',
  salads: '🥗',
  'momos-chaat': '🥟',
  juices: '🧃',
  lassi: '🥛',
  milkshakes: '🥤',
  mocktails: '🍹',
  beverages: '💧',
};

const categoryLabels = {
  soup: 'Soups',
  'veg-starters': 'Veg Starters',
  'nonveg-starters': 'Non-Veg Starters',
  'tandoor-kabab': 'Tandoor & Kabab',
  bread: 'Breads & Naan',
  biryani: 'Biryani',
  'veg-curry': 'Veg Curries',
  'nonveg-curry': 'Non-Veg Curries',
  'veg-rice': 'Veg Rice',
  'nonveg-rice': 'Non-Veg Rice',
  'chinese-veg': 'Chinese (Veg)',
  'chinese-nonveg': 'Chinese (Non-Veg)',
  noodles: 'Noodles',
  thali: 'Thali',
  desserts: 'Desserts',
  salads: 'Salads & Papad',
  'momos-chaat': 'Momos & Chaat',
  juices: 'Fresh Juices',
  lassi: 'Lassi',
  milkshakes: 'Milkshakes',
  mocktails: 'Mocktails',
  beverages: 'Beverages',
};

const sections = [
  ['soup', [
    ['Hot & Sour Veg Soup', 75], ['Hot & Sour Chicken Soup', 95], ['Veg Manchow Soup', 85],
    ['Chicken Manchow Soup', 105], ['Tomato Soup', 75], ['Veg Clear Soup', 85],
    ['Non-Veg Clear Soup', 105], ['Babycorn Soup', 90], ['LIMRA Special Non-Veg Soup', 125],
  ]],
  ['veg-starters', [
    ['Paneer 65', 135], ['Gobi 65', 95], ['Crispy Veg', 115], ['Mushroom Pepper Fry', 175],
    ['Chilli Mushroom Dry', 175], ['Chana Fry', 95], ['Spiral Potato Fry', 40], ['Mushroom 65', 110],
  ]],
  ['nonveg-starters', [
    ['Chicken 65', 145], ['Crispy Chicken', 165], ['Chilli Chicken Dry', 145], ['Dragon Chicken', 195],
    ['Hot Garlic Chicken Dry', 155], ['Chicken Lollipop', 180], ['Lemon Chicken Dry', 155],
    ['Mutton Pepper Fry', 355], ['Paper Chicken Dry', 155], ['Fish Fry', 75], ['Fish Tandoor', 95],
    ['Prawns Fry', 235],
  ]],
  ['tandoor-kabab', [
    ['Murg Chicken Tikka', 165], ['Malai Kabab', 225], ['Haryali Kabab', 180], ['Sikhari Kabab', 195],
    ['Tangdi Mumtaj', 290], ['Afgani Chicken (Full)', 425], ['Afgani Chicken (Half)', 230],
    ['Reshmi Kabab', 210], ['Irani Kabab', 215], ['Tandoori Chicken (Full)', 390],
    ['Tandoori Chicken (Half)', 210], ['Tandoori Chicken (Quarter)', 110],
    ['Kabab Platter (Malai, Haryali, Tikka, Sikhari, Tangdi)', 690], ['Paneer Tikka', 185],
    ['LIMRA Special Platter (Full Chicken + Kababs)', 855],
  ]],
  ['bread', [
    ['Tandoori Roti', 15], ['Butter Roti', 20], ['Plain Naan', 30], ['Butter Naan', 35],
    ['Garlic Naan', 45], ['Butter Kulcha', 35], ['Masala Kulcha', 55], ['Cheese Garlic Naan', 60],
    ['Aloo Paratha', 45], ['Tandoori Paratha', 35], ['Tandoori Laccha Paratha', 45],
    ['Paneer Kulcha', 50], ['Cheese Naan', 50],
  ]],
  ['biryani', [
    ['Hyderabadi Chicken Biryani (Full)', 140], ['Hyderabadi Chicken Biryani (Half)', 100],
    ['Mutton Biryani', 245], ['Khuska', 90],
    ['LIMRA Tandoori Special Biryani (Full Chicken + Raita + Salad + Papad)', 895], ['Raita', 30],
  ]],
  ['veg-curry', [
    ['Kadai Paneer', 175], ['Matar Paneer', 170], ['Handi Paneer', 175], ['Paneer Butter Masala', 180],
    ['Paneer Do-Pyaza', 185], ['Mix Veg', 155], ['Kadai Veg', 150], ['Dal Tadka', 95], ['Dal Fry', 85],
    ['Dal Butter Fry', 90], ['Dal Egg Tadka', 105], ['Aloo Dum', 70], ['Aloo Gobi', 85],
    ['Chana Masala', 110], ['Kadai Mushroom', 175], ['Paneer Tikka Masala', 205], ['Egg Omelet', 35],
    ['Veg Sahi Korma', 215], ['Egg Bhurji', 55],
  ]],
  ['nonveg-curry', [
    ['Chicken Kosa (Full)', 170], ['Chicken Kosa (Half)', 125], ['Chicken Masala', 180],
    ['Handi Chicken', 190], ['Chicken Tikka Masala', 185], ['Kadai Chicken', 190],
    ['Chicken Kopta Gravy', 195], ['Chicken Bharta', 195], ['Butter Chicken Masala', 215],
    ['Chicken Kolapuri', 205], ['Prawns Sabnam Curry', 270], ['Chicken Do-Pyaza', 205],
    ['Pepper Prawns', 285], ['Chicken Hyderabadi', 200], ['Moghlai Chicken', 215], ['Pepper Chicken', 190],
    ['Egg Curry', 90], ['LIMRA Special Chicken Curry', 250], ['Mutton Kasa (Full)', 345],
    ['Mutton Kasa (Half)', 235], ['Mutton Rogan Josh', 385], ['Mutton Hyderabadi', 370],
    ['Mutton Kolapuri', 390], ['LIMRA Special Mutton Kasa', 490],
  ]],
  ['veg-rice', [
    ['Steam Rice', 70], ['Jeera Rice', 80], ['Ghee Rice', 85], ['Kashmiri Pulao', 125],
    ['Veg Pulao', 105], ['Veg Fried Rice', 95], ['Veg Schezwan Fried Rice', 115], ['Paneer Pulao', 125],
  ]],
  ['nonveg-rice', [
    ['Egg Fried Rice', 100], ['Chicken Fried Rice', 125], ['Mix Fried Rice', 155],
    ['Szechwan Chicken Fried Rice', 145], ['Chicken Singapore Rice', 155], ['LIMRA Special Chicken Rice', 175],
  ]],
  ['chinese-nonveg', [
    ['Chilli Chicken (Bone)', 145], ['Chilli Chicken (Boneless)', 155], ['Chicken Manchurian', 145],
    ['Garlic Chicken', 155], ['Lemon Chicken', 155], ['Szechuan Chicken', 165], ['Chilli Prawns', 255],
    ['Szechuan Prawns', 265], ['Garlic Prawns', 260], ['Hong Kong Chicken', 170],
    ['Hot Garlic Lemon Prawns', 270],
  ]],
  ['chinese-veg', [
    ['Chilli Paneer', 155], ['Chilli Mushroom', 170], ['Mushroom Manchurian', 185],
    ['Veg Manchurian', 120], ['Garlic Paneer', 160], ['Paneer Manchurian', 165],
  ]],
  ['noodles', [
    ['Veg Noodles', 80], ['Egg Noodles', 100], ['Egg Chicken Noodles', 125], ['Mix Chowmein', 145],
    ['Chicken Szechuan Noodles', 135], ['Chicken Gravy Noodles', 135],
  ]],
  ['thali', [
    ['Veg Thali', 135], ['Fish Thali', 165], ['Chicken Thali', 205], ['Mutton Thali', 285],
    ['LIMRA Special Thali', 395],
  ]],
  ['desserts', [
    ['Hot Chocolate Fudge', 110], ['Fruit Salad with Ice Cream', 145], ['Vanilla with Dry Fruits', 45],
    ['Butterscotch Ice Cream', 55], ['Strawberry Ice Cream', 50],
  ]],
  ['salads', [
    ['Green Salad', 40], ['Onion Salad', 30], ['Roasted Papad', 20], ['Masala Papad', 40],
    ['Fry Papad', 15], ['Raita', 20], ['Chaas', 35],
  ]],
  ['momos-chaat', [
    ['Veg Steam Momo', 75], ['Veg Fried Momo', 80], ['Veg Pan Fried Momo', 85],
    ['Chicken Steam Momo', 90], ['Chicken Fried Momo', 95], ['Chicken Pan Fried Momo', 100],
    ['Sev Puri Chaat', 45], ['Papdi Chaat', 55],
  ]],
  ['juices', [
    ['Lime Juice', 25], ['Watermelon Juice', 35], ['Orange Juice', 55], ['Mosambi Juice', 60],
    ['Pineapple Juice', 65], ['Carrot Juice', 35], ['Mango Juice', 45],
  ]],
  ['lassi', [['Sweet Yogurt Lassi', 40], ['Dry Fruit Lassi', 55]]],
  ['milkshakes', [
    ['Banana Milkshake', 65], ['Mango Milkshake', 65], ['Pineapple Milkshake', 75],
    ['Oreo Milkshake', 85], ['KitKat Milkshake', 85], ['Vanilla Milkshake', 80],
    ['Dairy Milk Milkshake', 85], ['Butterscotch Milkshake', 85], ['Cold Coffee', 95],
    ['Strawberry Milkshake', 95],
  ]],
  ['mocktails', [
    ['Fresh Lime Soda', 45], ['Blue Lagoon', 60], ['Orange Mojito', 55], ['Lime Mint Mojito', 50],
    ['Masala Soda', 55], ['Strawberry Mojito', 55], ['Kala Khatta Mojito', 60],
    ['Green Apple Mojito', 55], ['Three Layer Mocktail', 95], ['Virgin Mojito', 55],
  ]],
  ['beverages', [
    ['Water 1 Litre', 20], ['Water 500ml', 10], ['Thums Up Glass', 25], ['Sprite Glass', 25],
    ['Masala Cold Drink', 35],
  ]],
];

let id = 1;
const menuItems = [];
for (const [cat, list] of sections) {
  for (const [name, price] of list) {
    menuItems.push({ id: id++, name, price, category: cat, emoji: categoryEmojis[cat] });
  }
}

const categoryTabOrder = Object.keys(categoryLabels);

const file = `// LIMRA Restaurant — menu (${menuItems.length} items, updated menu)
export const categoryImages = ${JSON.stringify(categoryImages, null, 2)};

export const categoryEmojis = ${JSON.stringify(categoryEmojis, null, 2)};

export const categoryLabels = ${JSON.stringify(categoryLabels, null, 2)};

export const categoryTabOrder = ${JSON.stringify(categoryTabOrder, null, 2)};

export const menuItems = ${JSON.stringify(menuItems, null, 2)};
`;

writeFileSync('src/data/menu.js', file);
console.log('Wrote', menuItems.length, 'menu items to src/data/menu.js');
