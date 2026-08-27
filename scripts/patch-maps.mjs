import { readFileSync, writeFileSync } from 'fs';

const MAPS_LINK = 'https://www.google.com/maps/place/LIMRA+RESTAURANT/@21.8603074,87.4768049,17z/data=!3m1!4b1!4m6!3m5!1s0x3a1d2b2614f3c155:0xdf9ca79af511eaca!8m2!3d21.8603074!4d87.4793798!16s%2Fg%2F11wwq23wgv?authuser=0&entry=ttu&g_ep=EgoyMDI2MDUyNy4wIKXMDSoASAFQAw%3D%3D';

// Google Maps embed URL using the exact Place ID
const EMBED_URL = 'https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3726.9!2d87.47680!3d21.86031!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x3a1d2b2614f3c155%3A0xdf9ca79af511eaca!2sLIMRA+RESTAURANT!5e0!3m2!1sen!2sin!4v1748627000000!5m2!1sen!2sin';

let html = readFileSync('index.html', 'utf8');

// 1. Update the small "Get Directions →" link in the Address info card (line 774)
html = html.replace(
  'href="https://maps.google.com/?q=Nimtala,Alangiri,Egra,Purba+Medinipur"',
  `href="${MAPS_LINK}"`
);

// 2. Update the big "Get Directions on Google Maps" button (line 811)
html = html.replace(
  'href="https://maps.google.com/?q=Nimtala,Alangiri,Egra,Purba+Medinipur,West+Bengal"',
  `href="${MAPS_LINK}"`
);

// 3. Update the embedded iframe map src
html = html.replace(
  /src="https:\/\/www\.google\.com\/maps\/embed[^"]*"/,
  `src="${EMBED_URL}"`
);

writeFileSync('index.html', html, 'utf8');
console.log('✅ All Google Maps links updated with exact LIMRA Restaurant location.');
