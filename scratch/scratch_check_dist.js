import fs from 'fs';
import path from 'path';

function getDirInfo(dir, fileList = [], totalSize = 0) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      const info = getDirInfo(filePath, fileList, totalSize);
      fileList = info.fileList;
      totalSize = info.totalSize;
    } else {
      fileList.push({ path: filePath, size: stat.size });
      totalSize += stat.size;
    }
  }
  return { fileList, totalSize };
}

try {
  const info = getDirInfo('dist');
  console.log(`Total files: ${info.fileList.length}`);
  console.log(`Total size: ${(info.totalSize / 1024 / 1024).toFixed(2)} MB`);
  
  // Sort by size descending and print top 10 largest files
  info.fileList.sort((a, b) => b.size - a.size);
  console.log('\nTop 10 largest files:');
  info.fileList.slice(0, 10).forEach(f => {
    console.log(`- ${f.path} (${(f.size / 1024).toFixed(2)} KB)`);
  });
} catch (e) {
  console.error(e);
}
