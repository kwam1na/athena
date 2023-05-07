/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  darkMode: false,
  theme: {
    extend: {
      backgroundColor: {
        "brand-bg": "#141414",
      },
      textColor: {
        "brand-bg": "#141414",
      },
    },
  },
  plugins: [],
};
