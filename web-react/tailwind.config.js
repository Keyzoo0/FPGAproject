/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#0a0d12',
        panel: '#0d1117',
        card: '#161b22',
        border: '#21262d',
        muted: '#8b949e',
        text: '#e6edf3',
        accent: '#58a6ff',
        ok: '#3fb950',
        warn: '#d29922',
        danger: '#f85149',
      },
      fontFamily: {
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
    },
  },
  plugins: [],
};
