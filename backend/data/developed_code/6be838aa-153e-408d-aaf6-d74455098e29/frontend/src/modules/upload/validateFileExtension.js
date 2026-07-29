// Allowed text-based file extensions (lowercase, without leading dot)
export const ALLOWED_TEXT_EXTENSIONS = ['txt', 'csv'];

export function getExtension(filename) {
  if (!filename || typeof filename !== 'string') {
    return '';
  }
  const lastDot = filename.lastIndexOf('.');
  if (lastDot === -1 || lastDot === filename.length - 1) {
    return '';
  }
  return filename.slice(lastDot + 1).toLowerCase();
}

export function isValidTextExtension(
  filename,
  allowedExtensions = ALLOWED_TEXT_EXTENSIONS
) {
  const extension = getExtension(filename);
  const normalized = allowedExtensions.map((e) =>
    e.toLowerCase().replace(/^\./, '')
  );
  return normalized.includes(extension);
}

export function validateTextExtension(
  filename,
  allowedExtensions = ALLOWED_TEXT_EXTENSIONS
) {
  if (isValidTextExtension(filename, allowedExtensions)) {
    return { valid: true, error: null };
  }
  const allowed = allowedExtensions
    .map((e) => e.toLowerCase().replace(/^\./, ''))
    .join(', ');
  return {
    valid: false,
    error: `Unsupported file type. Only text-based files are allowed: ${allowed}.`,
  };
}
