/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/renderer/index.html',
    './src/renderer/src/**/*.{js,ts,jsx,tsx}',
    'node_modules/flowbite-react/lib/esm/**/*.js'
  ],
  theme: {
    extend: {
      animation: {
        'pulse-slide': 'pulseSlide 1.5s ease-in-out infinite',
        'gradient-x': 'gradient-x 5s ease infinite'
      },
      keyframes: {
        pulseSlide: {
          '0%, 100%': { transform: 'translateX(-100%)' },
          '50%': { transform: 'translateX(200%)' }
        },
        'gradient-x': {
          '0%, 100%': {
            'background-position': '0% 50%'
          },
          '50%': {
            'background-position': '100% 50%'
          }
        }
      }
    }
  },
  plugins: [require('flowbite/plugin')],
  darkMode: 'media'
}