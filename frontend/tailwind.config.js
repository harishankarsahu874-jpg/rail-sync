/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        ink: { 950: '#070b17', 900: '#0a1020', 850: '#0c1226', 800: '#101a33', 700: '#16224a' },
        line: '#1c2951',
        ir: { blue: '#4f6ef7', sky: '#8fa5ff' },
        ok: '#2ee6a8',
        warn: '#ffc233',
        bad: '#ff5c5c',
        board: '#ffd23f',
        muted: '#8b96c2',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      keyframes: {
        'pulse-dot': {
          '0%, 100%': { boxShadow: '0 0 0 0 rgba(46,230,168,0.55)' },
          '50%': { boxShadow: '0 0 0 6px rgba(46,230,168,0)' },
        },
        'pulse-dot-warn': {
          '0%, 100%': { boxShadow: '0 0 0 0 rgba(255,194,51,0.55)' },
          '50%': { boxShadow: '0 0 0 6px rgba(255,194,51,0)' },
        },
        'flash-row': { '0%, 100%': { opacity: 1 }, '50%': { opacity: 0.35 } },
        'slide-in': { from: { transform: 'translateX(24px)', opacity: 0 }, to: { transform: 'none', opacity: 1 } },
        'board-blink': { '0%, 100%': { opacity: 1 }, '50%': { opacity: 0.25 } },
      },
      animation: {
        'pulse-dot': 'pulse-dot 2s infinite',
        'pulse-dot-warn': 'pulse-dot-warn 2s infinite',
        'flash-row': 'flash-row 1.6s infinite',
        'slide-in': 'slide-in 0.25s ease-out',
        'board-blink': 'board-blink 1.2s infinite',
      },
    },
  },
  plugins: [],
};
