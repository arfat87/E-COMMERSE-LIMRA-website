/**
 * LIMRA POS — Dish Image Optimization & Compression Engine
 * 
 * Enforces client-side image compression:
 * - Target size: 30 KB - 80 KB
 * - Maximum allowed size: 150 KB
 * - Format: Modern WebP with JPEG fallback
 * - Preserves aspect ratio with max dimension bounds (800x800)
 */

export const COMPRESSION_LIMITS = {
  MAX_SIZE_KB: 150,
  TARGET_SIZE_KB: 75,
  MIN_SIZE_KB: 25,
  MAX_WIDTH: 800,
  MAX_HEIGHT: 800,
  SUPPORTED_MIME_TYPES: ['image/jpeg', 'image/png', 'image/webp', 'image/jpg']
};

/**
 * Format bytes to readable KB/MB string
 */
export function formatFileSize(bytes) {
  if (!bytes || isNaN(bytes)) return '0 KB';
  const kb = bytes / 1024;
  if (kb < 1024) {
    return `${kb.toFixed(1)} KB`;
  }
  return `${(kb / 1024).toFixed(2)} MB`;
}

/**
 * Check if the browser supports Canvas to WebP export
 */
export function supportsWebP() {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    return canvas.toDataURL('image/webp').indexOf('data:image/webp') === 0;
  } catch (e) {
    return false;
  }
}

/**
 * Compress an image file in-browser using HTMLCanvasElement.
 * 
 * @param {File|Blob} file - The raw input file from input[type=file]
 * @param {Object} [customOptions] - Optional configuration overrides
 * @returns {Promise<{ blob: Blob, dataUrl: string, file: File, sizeKB: number, width: number, height: number, format: string, compressionRatio: string }>}
 */
export async function compressDishImage(file, customOptions = {}) {
  if (!file) {
    throw new Error('No image file provided for compression.');
  }

  // Validate MIME type
  const mimeType = file.type?.toLowerCase() || '';
  if (mimeType && !COMPRESSION_LIMITS.SUPPORTED_MIME_TYPES.includes(mimeType)) {
    throw new Error('Unsupported image format. Please select a JPEG, PNG, or WebP photo.');
  }

  const options = {
    maxSizeKB: COMPRESSION_LIMITS.MAX_SIZE_KB,
    targetSizeKB: COMPRESSION_LIMITS.TARGET_SIZE_KB,
    maxWidth: COMPRESSION_LIMITS.MAX_WIDTH,
    maxHeight: COMPRESSION_LIMITS.MAX_HEIGHT,
    ...customOptions
  };

  const originalSize = file.size;

  // 1. Load image into HTMLImageElement
  const img = await new Promise((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Failed to decode image. The file may be corrupted.'));
    };
    image.src = objectUrl;
  });

  // 2. Compute proportional dimensions preserving aspect ratio
  let { width, height } = img;
  if (width > options.maxWidth || height > options.maxHeight) {
    const ratio = Math.min(options.maxWidth / width, options.maxHeight / height);
    width = Math.round(width * ratio);
    height = Math.round(height * ratio);
  }

  // 3. Draw on off-screen Canvas with high-quality smoothing
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Canvas 2D context not available on this device.');
  }

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  // Fill white background for transparent PNGs converted to JPEG/WebP
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);

  // 4. Determine export format
  const exportFormat = supportsWebP() ? 'image/webp' : 'image/jpeg';
  const fileExt = exportFormat === 'image/webp' ? '.webp' : '.jpg';

  // 5. Intelligent iterative quality compression loop
  let quality = 0.82;
  let compressedBlob = null;
  let compressedDataUrl = '';

  for (let attempt = 0; attempt < 5; attempt++) {
    compressedDataUrl = canvas.toDataURL(exportFormat, quality);
    
    // Convert Data URL to Blob
    const binary = atob(compressedDataUrl.split(',')[1]);
    const array = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      array[i] = binary.charCodeAt(i);
    }
    compressedBlob = new Blob([array], { type: exportFormat });

    const sizeKB = compressedBlob.size / 1024;

    // Check if within acceptable bounds
    if (sizeKB <= options.targetSizeKB || quality <= 0.45) {
      break;
    }

    // Step down quality
    if (sizeKB > options.maxSizeKB) {
      quality -= 0.15;
    } else {
      quality -= 0.08;
    }
  }

  // 6. Secondary fallback: if still > 150 KB, resize dimensions further down to 600px
  if (compressedBlob && (compressedBlob.size / 1024) > options.maxSizeKB) {
    const scale = 0.75;
    const fallbackCanvas = document.createElement('canvas');
    fallbackCanvas.width = Math.round(width * scale);
    fallbackCanvas.height = Math.round(height * scale);
    const fbCtx = fallbackCanvas.getContext('2d');
    fbCtx.imageSmoothingEnabled = true;
    fbCtx.imageSmoothingQuality = 'high';
    fbCtx.fillStyle = '#FFFFFF';
    fbCtx.fillRect(0, 0, fallbackCanvas.width, fallbackCanvas.height);
    fbCtx.drawImage(canvas, 0, 0, fallbackCanvas.width, fallbackCanvas.height);

    compressedDataUrl = fallbackCanvas.toDataURL(exportFormat, 0.55);
    const binary = atob(compressedDataUrl.split(',')[1]);
    const array = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      array[i] = binary.charCodeAt(i);
    }
    compressedBlob = new Blob([array], { type: exportFormat });
  }

  const finalSizeKB = compressedBlob ? (compressedBlob.size / 1024) : 0;

  // Strict enforcement: Hard reject if > 150 KB
  if (finalSizeKB > options.maxSizeKB) {
    throw new Error(
      `Compressed image is ${finalSizeKB.toFixed(1)} KB, which exceeds the 150 KB limit. Please choose a smaller photo.`
    );
  }

  // Generate a clean sanitized file name
  const originalBase = (file.name || 'dish_photo').replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '_');
  const finalFileName = `${originalBase}_${Date.now()}${fileExt}`;

  const optimizedFile = new File([compressedBlob], finalFileName, {
    type: exportFormat,
    lastModified: Date.now()
  });

  const ratioPct = originalSize > 0 ? ((1 - (compressedBlob.size / originalSize)) * 100).toFixed(0) : '0';

  return {
    blob: compressedBlob,
    dataUrl: compressedDataUrl,
    file: optimizedFile,
    sizeKB: Number(finalSizeKB.toFixed(1)),
    width,
    height,
    format: exportFormat,
    originalSizeKB: Number((originalSize / 1024).toFixed(1)),
    compressionRatio: `${ratioPct}% smaller`
  };
}
