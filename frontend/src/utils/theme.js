import darkCss from '../styles/dark.css?inline';

const KEY = 'formpilot.theme';
const STYLE_ID = 'theme-dark';

export function getStoredTheme() {
  try { return globalThis.localStorage?.getItem(KEY) === 'light' ? 'light' : 'dark'; } catch { return 'dark'; }
}

/** Dark is the default. Light simply removes the injected dark stylesheet. */
export function applyTheme(theme) {
  const root = document.documentElement;
  let style = document.getElementById(STYLE_ID);
  if (theme === 'dark') {
    if (!style) { style = document.createElement('style'); style.id = STYLE_ID; style.textContent = darkCss; document.head.appendChild(style); }
  } else style?.remove();
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
  try { globalThis.localStorage?.setItem(KEY, theme); } catch { /* storage unavailable */ }
}
