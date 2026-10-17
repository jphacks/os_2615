/* 見やすさの設定は端末内だけに保存する。共有Inboxのデータは変更しない。 */
export const SETTINGS_KEY = 'konekuto.settings.v1';
export const defaultSettings = { theme: 'system', fontSize: 'normal' };
export function normalizeSettings(value) {
  return {
    theme: ['system', 'light', 'dark'].includes(value?.theme) ? value.theme : 'system',
    fontSize: ['small', 'normal', 'large', 'extra-large'].includes(value?.fontSize) ? value.fontSize : 'normal'
  };
}
export function readSettings(storage) {
  try { return normalizeSettings(JSON.parse(storage.getItem(SETTINGS_KEY))); }
  catch { return { ...defaultSettings }; }
}
export function writeSettings(storage, value) {
  try { storage.setItem(SETTINGS_KEY, JSON.stringify(normalizeSettings(value))); return true; }
  catch { return false; }
}
export function applySettings(settings) {
  const dark = settings.theme === 'dark' || (settings.theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.documentElement.dataset.fontSize = settings.fontSize;
}
