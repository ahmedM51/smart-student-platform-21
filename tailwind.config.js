/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: { cairo: ['Cairo', 'sans-serif'] },
      borderRadius: { '4xl': '2rem', '5xl': '3rem' },
      colors: {
        indigo: {
          50: '#f5f7ff',
          100: '#ebf0fe',
          200: '#dae3fd',
          300: '#c0ccfb',
          400: '#9baaf7',
          500: '#6366f1',
          600: '#4f46e5',
          700: '#4338ca',
          800: '#3730a3',
          900: '#312e81',
          950: '#1e1b4b',
        },
        slate: {
          950: '#020617',
        },
      },
    },
  },
  plugins: [],
};
