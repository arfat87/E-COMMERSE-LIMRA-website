import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join, extname } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const EXTS = new Set(['.html', '.js', '.css', '.json', '.md', '.txt', '.xml']);
const SKIP = new Set(['node_modules', '.git', 'dist', 'public/media', 'scripts/_lightbox-append.js']);

const FROM = /menara bibi/gi;
const TO   = 'SK Arif';

let totalFiles = 0;
let totalReplacements = 0;

function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    const rel = full.replace(root + '\\', '').replace(root + '/', '');

    if (SKIP.has(entry.name) || [...SKIP].some(s => rel.startsWith(s))) continue;
    if (entry.isDirectory()) { walk(full); continue; }
    if (!EXTS.has(extname(entry.name).toLowerCase())) continue;

    const original = readFileSync(full, 'utf8');
    const replaced = original.replace(FROM, match => {
      // Preserve casing: "Menara Bibi" -> "SK Arif", "menara bibi" -> "SK Arif"
      return 'SK Arif';
    });

    if (replaced !== original) {
      const count = (original.match(FROM) || []).length;
      writeFileSync(full, replaced, 'utf8');
      console.log(`  ✅ ${rel}  (${count} replacement${count > 1 ? 's' : ''})`);
      totalFiles++;
      totalReplacements += count;
    }
  }
}

console.log('\n🔄 Replacing "Menara Bibi" → "SK Arif" everywhere...\n');
walk(root);
console.log(`\n✅ Done — ${totalReplacements} replacements in ${totalFiles} files.\n`);
