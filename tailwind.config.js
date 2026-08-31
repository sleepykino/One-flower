/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        /* P7.5 全局主题：实际使用色阶全部接 CSS 变量（:root / data-theme=dark / sepia 定义在 src/index.css） */
        ink: {
          50: 'rgb(var(--ink-50) / <alpha-value>)',
          100: 'rgb(var(--ink-100) / <alpha-value>)',
          200: 'rgb(var(--ink-200) / <alpha-value>)',
          300: 'rgb(var(--ink-300) / <alpha-value>)',
          400: 'rgb(var(--ink-400) / <alpha-value>)',
          500: 'rgb(var(--ink-500) / <alpha-value>)',
          600: 'rgb(var(--ink-600) / <alpha-value>)',
          700: 'rgb(var(--ink-700) / <alpha-value>)',
          800: 'rgb(var(--ink-800) / <alpha-value>)',
          900: 'rgb(var(--ink-900) / <alpha-value>)'
        },
        violet: {
          50: 'rgb(var(--violet-50) / <alpha-value>)',
          100: 'rgb(var(--violet-100) / <alpha-value>)',
          200: 'rgb(var(--violet-200) / <alpha-value>)',
          300: 'rgb(var(--violet-300) / <alpha-value>)',
          400: 'rgb(var(--violet-400) / <alpha-value>)',
          500: 'rgb(var(--violet-500) / <alpha-value>)',
          600: 'rgb(var(--violet-600) / <alpha-value>)',
          700: 'rgb(var(--violet-700) / <alpha-value>)',
          800: 'rgb(var(--violet-800) / <alpha-value>)',
          900: 'rgb(var(--violet-900) / <alpha-value>)'
        },
        emerald: {
          50: 'rgb(var(--emerald-50) / <alpha-value>)',
          100: 'rgb(var(--emerald-100) / <alpha-value>)',
          200: 'rgb(var(--emerald-200) / <alpha-value>)',
          300: 'rgb(var(--emerald-300) / <alpha-value>)',
          500: 'rgb(var(--emerald-500) / <alpha-value>)',
          600: 'rgb(var(--emerald-600) / <alpha-value>)',
          700: 'rgb(var(--emerald-700) / <alpha-value>)',
          800: 'rgb(var(--emerald-800) / <alpha-value>)',
          900: 'rgb(var(--emerald-900) / <alpha-value>)'
        },
        sky: {
          50: 'rgb(var(--sky-50) / <alpha-value>)',
          100: 'rgb(var(--sky-100) / <alpha-value>)',
          200: 'rgb(var(--sky-200) / <alpha-value>)',
          500: 'rgb(var(--sky-500) / <alpha-value>)',
          600: 'rgb(var(--sky-600) / <alpha-value>)',
          700: 'rgb(var(--sky-700) / <alpha-value>)'
        },
        amber: {
          50: 'rgb(var(--amber-50) / <alpha-value>)',
          100: 'rgb(var(--amber-100) / <alpha-value>)',
          200: 'rgb(var(--amber-200) / <alpha-value>)',
          300: 'rgb(var(--amber-300) / <alpha-value>)',
          400: 'rgb(var(--amber-400) / <alpha-value>)',
          500: 'rgb(var(--amber-500) / <alpha-value>)',
          600: 'rgb(var(--amber-600) / <alpha-value>)',
          700: 'rgb(var(--amber-700) / <alpha-value>)',
          800: 'rgb(var(--amber-800) / <alpha-value>)',
          900: 'rgb(var(--amber-900) / <alpha-value>)'
        },
        red: {
          50: 'rgb(var(--red-50) / <alpha-value>)',
          100: 'rgb(var(--red-100) / <alpha-value>)',
          200: 'rgb(var(--red-200) / <alpha-value>)',
          300: 'rgb(var(--red-300) / <alpha-value>)',
          400: 'rgb(var(--red-400) / <alpha-value>)',
          500: 'rgb(var(--red-500) / <alpha-value>)',
          600: 'rgb(var(--red-600) / <alpha-value>)',
          700: 'rgb(var(--red-700) / <alpha-value>)',
          800: 'rgb(var(--red-800) / <alpha-value>)'
        },
        blue: {
          500: 'rgb(var(--blue-500) / <alpha-value>)',
          600: 'rgb(var(--blue-600) / <alpha-value>)'
        },
        /* P7.5 D2：深色实心按钮专用 token（浅色=原 ink-900/800，零回归） */
        'btn-solid': 'rgb(var(--btn-solid) / <alpha-value>)',
        'btn-solid-hover': 'rgb(var(--btn-solid-hover) / <alpha-value>)'
      }
    }
  },
  plugins: []
};
