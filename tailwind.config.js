/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          50: '#f7f6f3',
          100: '#edeae4',
          200: '#d9d4ca',
          300: '#bfb8a9',
          400: '#a39a88',
          500: '#8a8070',
          600: '#6d655a',
          700: '#524c44',
          800: '#38342f',
          900: '#23211e'
        }
      }
    }
  },
  plugins: []
};
