import {
  getExtension,
  isValidTextExtension,
  validateTextExtension,
} from './validateFileExtension';

describe('validateFileExtension', () => {
  test('data.txt passes validation', () => {
    expect(isValidTextExtension('data.txt')).toBe(true);
    expect(validateTextExtension('data.txt').valid).toBe(true);
  });

  test('report.csv passes validation', () => {
    expect(isValidTextExtension('report.csv')).toBe(true);
    expect(validateTextExtension('report.csv').valid).toBe(true);
  });

  test('image.jpg fails validation with an error', () => {
    expect(isValidTextExtension('image.jpg')).toBe(false);
    const result = validateTextExtension('image.jpg');
    expect(result.valid).toBe(false);
    expect(result.error).toBeTruthy();
  });

  test('document.pdf fails validation with an error', () => {
    expect(isValidTextExtension('document.pdf')).toBe(false);
    const result = validateTextExtension('document.pdf');
    expect(result.valid).toBe(false);
    expect(result.error).toBeTruthy();
  });

  test('extension detection is case-insensitive', () => {
    expect(getExtension('DATA.TXT')).toBe('txt');
    expect(isValidTextExtension('REPORT.CSV')).toBe(true);
  });

  test('files without extension fail validation', () => {
    expect(isValidTextExtension('noextension')).toBe(false);
  });
});
