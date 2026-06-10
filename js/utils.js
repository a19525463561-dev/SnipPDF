/**
 * SnipPDF - Utility Functions
 */

// Illegal filename characters
const ILLEGAL = /[\\/:*?"<>|]/;

// Supported image formats
const SUPPORTED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/bmp', 'image/heic', 'image/heif'];

// Friendly format labels
const FORMAT_LABELS = {
  'image/jpeg': 'JPG',
  'image/png': 'PNG',
  'image/webp': 'WebP',
  'image/bmp': 'BMP',
  'image/heic': 'HEIC',
  'image/heif': 'HEIF'
};

/**
 * Check if a file type is supported
 */
function isSupportedType(type) {
  return SUPPORTED_TYPES.includes(type);
}

/**
 * Check if file might be HEIC (unsupported on most non-Safari browsers)
 */
function isHeicType(type) {
  return type === 'image/heic' || type === 'image/heif';
}

/**
 * Get friendly label for a format
 */
function getFormatLabel(type) {
  return FORMAT_LABELS[type] || 'IMG';
}

/**
 * Estimate PDF output size in bytes
 * @param {Array} images - Array of image objects with w, h
 * @param {string} compression - '20', '50', or '100'
 * @param {number} perPage - images per page
 * @returns {number} estimated size in bytes
 */
function estimatePdfSize(images, compression, perPage) {
  if (!images || !images.length) return 0;

  // Quality factor -> approximate bytes per pixel after JPEG encoding
  const BYTES_PER_PIXEL = {
    '20': 0.04,   // Quality 0.35 - high compression
    '50': 0.12,   // Quality 0.65 - balanced
    '100': 0.35   // Quality 0.92 - low compression
  };

  // PDF overhead per page (headers, structure) ~15KB
  const PAGE_OVERHEAD = 15 * 1024;

  const maxDim = 2000;
  let totalPixels = 0;

  for (const img of images) {
    const scale = (img.w > maxDim || img.h > maxDim)
      ? maxDim / Math.max(img.w, img.h)
      : 1;
    totalPixels += (img.w * scale) * (img.h * scale);
  }

  const pages = Math.ceil(images.length / perPage);
  const imageBytes = totalPixels * (BYTES_PER_PIXEL[compression] || 0.12);
  const overhead = pages * PAGE_OVERHEAD;

  return Math.round(imageBytes + overhead);
}

/**
 * Format bytes to human-readable size
 */
function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

/**
 * Validate filename
 */
function validateFilename(name) {
  if (ILLEGAL.test(name)) {
    return { valid: false, msg: '文件名包含非法字符，请重新输入' };
  }
  return { valid: true, msg: '' };
}

/**
 * Sanitize filename by removing illegal chars
 */
function sanitizeFilename(name) {
  return name.replace(ILLEGAL, '');
}

/**
 * Debounce utility
 */
function debounce(fn, delay) {
  let timer;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}
