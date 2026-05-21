import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        'bg-page': 'var(--bg-page)',
        'bg-card': 'var(--bg-card)',
        'bg-surface': 'var(--bg-surface)',
        'bg-hover': 'var(--bg-hover)',
        'text-primary': 'var(--text-primary)',
        'text-secondary': 'var(--text-secondary)',
        'text-tertiary': 'var(--text-tertiary)',
        accent: 'var(--accent)',
        'status-red': 'var(--status-red)',
        'status-red-bg': 'var(--status-red-bg)',
        'status-red-text': 'var(--status-red-text)',
        'status-amber': 'var(--status-amber)',
        'status-amber-bg': 'var(--status-amber-bg)',
        'status-amber-text': 'var(--status-amber-text)',
        'status-green': 'var(--status-green)',
        'status-green-bg': 'var(--status-green-bg)',
        'status-green-text': 'var(--status-green-text)',
      },
      borderColor: {
        hairline: 'var(--border-hairline)',
        emphasis: 'var(--border-emphasis)',
      },
      borderRadius: {
        sm: 'var(--radius-sm)',
        md: 'var(--radius-md)',
        lg: 'var(--radius-lg)',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
      },
      fontSize: {
        '11': ['11px', { lineHeight: '16px' }],
        '12': ['12px', { lineHeight: '16px' }],
        '13': ['13px', { lineHeight: '20px' }],
        '14': ['14px', { lineHeight: '20px' }],
        '18': ['18px', { lineHeight: '24px' }],
        '22': ['22px', { lineHeight: '28px' }],
      },
      fontWeight: {
        regular: '400',
        medium: '500',
      },
    },
  },
  plugins: [],
};

export default config;
