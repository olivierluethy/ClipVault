/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: { DEFAULT: "#121212", raised: "#1a1a1a", card: "#1e1e1e" },
        fg: { DEFAULT: "#e6e6e6", muted: "#9a9a9a" },
        accent: { DEFAULT: "#7C6CF0", dim: "#4b4488" },
        border: "#2a2a2a",
      },
    },
  },
  plugins: [],
};
