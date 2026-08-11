import type { Config } from 'tailwindcss';

// Design tokens carried over from the CAIA brand palette (teal/gold/ink),
// with violet reserved as AIPeT's signature accent for tutor/AI surfaces.
const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        ink: {
          950: '#0B0F20', // deepest background
          900: '#10162B', // logo bg start
          800: '#161D3E', // logo bg end
          700: '#232B52',
          600: '#333C6B',
        },
        mist: {
          400: '#9AA3C0', // muted label / tagline color from logo
          200: '#C7CCE0',
        },
        teal: {
          400: '#7FD9D0',
          500: '#4FD8C7',
          600: '#2FA79B', // primary accent
        },
        gold: {
          400: '#E0C15A',
          500: '#C9A227', // secondary accent — CTAs, prices
          600: '#A9840F',
        },
        violet: {
          400: '#A99BEF',
          500: '#8C7AE6', // tertiary accent — AIPeT / AI-specific surfaces
          600: '#6E5AD1',
        },
      },
      fontFamily: {
        display: ['var(--font-display)'],
        body: ['var(--font-body)'],
        mono: ['var(--font-mono)'],
      },
      backgroundImage: {
        'ink-gradient': 'linear-gradient(135deg, #10162B 0%, #161D3E 100%)',
        'accent-bar': 'linear-gradient(180deg, #C9A227 0%, #2FA79B 100%)',
      },
      borderRadius: {
        brand: '1.25rem',
      },
    },
  },
  plugins: [],
};

export default config;
