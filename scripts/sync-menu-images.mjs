/**
 * Match photos in src/MEDIA to menu items, copy to public/media/items/, update menu.js
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname, extname, basename } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const mediaRoot = join(root, 'src', 'MEDIA');
const outDir = join(root, 'public', 'media', 'items');
const menuPath = join(root, 'src', 'data', 'menu.js');

const folderToCategory = {
  // already mapped
  'soups': 'soup',
  'vegetarian starters': 'veg-starters',
  'non-vegetarian starters': 'nonveg-starters',
  'tandoori and kabab': 'tandoor-kabab',
  'breads - roti - naan - kulcha': 'bread',
  'biryani': 'biryani',
  'vegetarian curries': 'veg-curry',
  'non vegetarian curries': 'nonveg-curry',
  'vegetarian rice dishes': 'veg-rice',
  'non vegetarian rice dishes': 'nonveg-rice',
  'chinese veg': 'chinese-veg',
  'chinese non veg': 'chinese-nonveg',
  'noodles chowmin': 'noodles',
  // newly added
  'bengali thali': 'thali',
  'desserts and ice cream': 'desserts',
  'fresh juice': 'juices',
  'lassi': 'lassi',
  'milkshakes': 'milkshakes',
  'mocktails & mojitos': 'mocktails',
  'momos & chats': 'momos-chaat',
  'salads & papad': 'salads',
  'bottle': 'beverages',
  // interiar = restaurant photos, skip food matching
};

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.avif']);

function normalize(s) {
  return s
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/([a-z])(\d)/g, '$1 $2')
    .replace(/(\d)([a-z])/g, '$1 $2')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\bchiken\b/g, 'chicken')
    .replace(/\bchili\b/g, 'chilli')
    .replace(/\bvej\b/g, 'veg')
    .replace(/\bmixed\b/g, 'mix')
    .replace(/\blolipop\b/g, 'lollipop')
    .replace(/\bluccha\b/g, 'laccha')
    .replace(/\bfriend\b/g, 'fried')
    .replace(/\bschezwan\b/g, 'szechwan')
    .replace(/\bszechuan\b/g, 'szechwan')
    .replace(/\bchowmin\b/g, 'chowmein')
    .replace(/\btandoor\b/g, 'tandoori')
    .replace(/\bsabnam\b/g, 'sabnam')
    .replace(/\bkasa\b/g, 'kosa')
    .replace(/\bafgani\b/g, 'afgani')
    .replace(/\bafghani\b/g, 'afgani')
    .replace(/\bmurgh\b/g, 'murg')
    .replace(/\band\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function matchScore(menuName, fileStem) {
  const m = normalize(menuName);
  const f = normalize(fileStem);
  if (!m || !f) return 0;
  if (m === f) return 100;
  if (m.startsWith(f) || f.startsWith(m)) return 85;
  if (m.includes(f) || f.includes(m)) return 70;

  const mTokens = new Set(m.split(' ').filter(Boolean));
  const fTokens = f.split(' ').filter(Boolean);
  if (fTokens.length === 0) return 0;
  let overlap = 0;
  for (const t of fTokens) {
    if (mTokens.has(t)) overlap += 1;
  }
  const ratio = overlap / Math.max(fTokens.length, mTokens.size);
  return Math.round(ratio * 65);
}

function loadMenuItems() {
  const src = readFileSync(menuPath, 'utf8');
  const match = src.match(/export const menuItems = (\[[\s\S]*\]);/);
  if (!match) throw new Error('Could not parse menuItems from menu.js');
  return JSON.parse(match[1]);
}

function loadMenuExports() {
  const src = readFileSync(menuPath, 'utf8');
  const exports = {};
  for (const key of ['categoryImages', 'categoryEmojis', 'categoryLabels', 'categoryTabOrder']) {
    // Handle both LF and CRLF line endings
    const re = new RegExp(`export const ${key} = ([\\s\\S]*?);\\r?\\n\\r?\\nexport`);
    const m = src.match(re);
    if (!m) {
      // Fallback: match to end of block by }; or ];
      const re2 = new RegExp(`export const ${key} = ([\\s\\S]*?(?:}|\\]);)`);
      const m2 = src.match(re2);
      if (!m2) throw new Error(`Could not parse ${key}`);
      exports[key] = JSON.parse(m2[1].replace(/;\s*$/, ''));
    } else {
      exports[key] = JSON.parse(m[1]);
    }
  }
  return exports;
}

function collectMediaFiles() {
  const byCategory = new Map();
  if (!existsSync(mediaRoot)) {
    console.warn('No src/MEDIA folder found');
    return byCategory;
  }
  for (const folder of readdirSync(mediaRoot, { withFileTypes: true })) {
    if (!folder.isDirectory()) continue;
    const catKey = folderToCategory[folder.name.toLowerCase()];
    if (!catKey) {
      console.warn('Unknown MEDIA folder:', folder.name);
      continue;
    }
    const dir = join(mediaRoot, folder.name);
    const files = readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile() && IMAGE_EXT.has(extname(e.name).toLowerCase()))
      .map((e) => ({
        path: join(dir, e.name),
        stem: basename(e.name, extname(e.name)),
        ext: extname(e.name).toLowerCase(),
      }));
    if (!byCategory.has(catKey)) byCategory.set(catKey, []);
    byCategory.get(catKey).push(...files);
  }
  return byCategory;
}

/** File stem (normalized) → exact menu item name when auto-match fails */
const manualByStem = new Map([
  [normalize('chilli chicken boneless'), 'Chilli Chicken (Boneless)'],
  [normalize('chicken Singapore fried rice'), 'Chicken Singapore Rice'],
]);

mkdirSync(outDir, { recursive: true });

const menuItems = loadMenuItems();
const exports = loadMenuExports();
const mediaByCategory = collectMediaFiles();

const fileUseCount = new Map();
let matched = 0;
const unmatchedFiles = [];

const manualFileByItemName = new Map();
for (const [cat, files] of mediaByCategory) {
  for (const file of files) {
    const stemKey = normalize(file.stem);
    const menuName = manualByStem.get(stemKey);
    if (menuName) manualFileByItemName.set(menuName, file);
  }
}

for (const item of menuItems) {
  const files = mediaByCategory.get(item.category) || [];
  let best = manualFileByItemName.get(item.name) || null;
  let bestScore = best ? 100 : 0;

  for (const file of files) {
    const score = matchScore(item.name, file.stem);
    if (score > bestScore) {
      bestScore = score;
      best = file;
    }
  }

  if (best && bestScore >= 50) {
    const outName = `${item.id}${best.ext}`;
    const dest = join(outDir, outName);
    copyFileSync(best.path, dest);
    item.image = `/media/items/${outName}`;
    fileUseCount.set(best.path, (fileUseCount.get(best.path) || 0) + 1);
    matched += 1;
  } else {
    delete item.image;
  }
}

function baseName(name) {
  return normalize(name).replace(/\b(full|half|quarter|bone|boneless)\b/g, '').replace(/\s+/g, ' ').trim();
}

for (const item of menuItems) {
  if (item.image) continue;
  const sibling = menuItems.find(
    (o) => o.category === item.category && o.image && baseName(o.name) === baseName(item.name),
  );
  if (!sibling) continue;
  const ext = extname(sibling.image);
  const srcPath = join(outDir, `${sibling.id}${ext}`);
  if (!existsSync(srcPath)) continue;
  const outName = `${item.id}${ext}`;
  copyFileSync(srcPath, join(outDir, outName));
  item.image = `/media/items/${outName}`;
  matched += 1;
}

for (const [cat, files] of mediaByCategory) {
  for (const file of files) {
    if (!fileUseCount.has(file.path)) {
      unmatchedFiles.push({ category: cat, file: file.stem });
    }
  }
}

const file = `// LIMRA Restaurant — menu (${menuItems.length} items, updated menu)
export const categoryImages = ${JSON.stringify(exports.categoryImages, null, 2)};

export const categoryEmojis = ${JSON.stringify(exports.categoryEmojis, null, 2)};

export const categoryLabels = ${JSON.stringify(exports.categoryLabels, null, 2)};

export const categoryTabOrder = ${JSON.stringify(exports.categoryTabOrder, null, 2)};

export const menuItems = ${JSON.stringify(menuItems, null, 2)};
`;

writeFileSync(menuPath, file);

console.log(`Matched ${matched} / ${menuItems.length} menu items to photos`);
console.log(`Copied images to public/media/items/`);
if (unmatchedFiles.length) {
  console.log(`\nUnused photos (${unmatchedFiles.length}):`);
  unmatchedFiles.slice(0, 15).forEach((u) => console.log(`  [${u.category}] ${u.file}`));
  if (unmatchedFiles.length > 15) console.log(`  ... and ${unmatchedFiles.length - 15} more`);
}
const noPhoto = menuItems.filter((i) => !i.image).length;
if (noPhoto) {
  console.log(`\n${noPhoto} items use category placeholder (no photo in MEDIA or different category)`);
}
