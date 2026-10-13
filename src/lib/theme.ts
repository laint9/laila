// Giao diện sáng/tối: mặc định theo máy (macOS Appearance). Lưu lựa chọn trong localStorage.
export type Theme = 'system' | 'light' | 'dark'

export function getTheme(): Theme {
  try {
    const t = localStorage.getItem('laila.theme')
    return t === 'light' || t === 'dark' ? t : 'system'
  } catch {
    return 'system'
  }
}

export function applyTheme(t: Theme = getTheme()) {
  if (t === 'system') document.documentElement.removeAttribute('data-theme')
  else document.documentElement.setAttribute('data-theme', t)
}

export function setTheme(t: Theme) {
  try {
    localStorage.setItem('laila.theme', t)
  } catch {
    /* bỏ qua */
  }
  applyTheme(t)
}
