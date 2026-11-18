/** Map styling utilities to semantic theme roles. */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: { extend: { colors: { background: 'var(--background)', surface: 'var(--surface)', foreground: 'var(--foreground)', muted: 'var(--foreground-muted)', border: 'var(--border)', primary: 'var(--primary)' }, borderRadius: { DEFAULT: '6px' }, fontFamily: { sans: ['Geist Sans', 'sans-serif'], mono: ['Geist Mono', 'monospace'] } } },
  plugins: [],
};
