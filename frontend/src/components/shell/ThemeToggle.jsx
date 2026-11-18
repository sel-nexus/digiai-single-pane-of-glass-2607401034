/** Keep theme a presentation-only preference across routes. */
import { useState } from 'react';

/** Apply and persist the user's explicit light or dark theme choice. */
export function ThemeToggle() {
  const [theme, setTheme] = useState(document.documentElement.dataset.theme || 'light');
  const toggle = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('digiai-theme', next); } catch { /* Theme remains available when browser storage is disabled. */ }
    setTheme(next);
  };
  return (
    <button onClick={toggle} aria-label={`Use ${theme === 'dark' ? 'light' : 'dark'} theme`}>
      {theme === 'dark' ? 'Light theme' : 'Dark theme'}
    </button>
  );
}
