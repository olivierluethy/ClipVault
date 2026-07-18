/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Deep near-black base with layered raised surfaces (dark-mode only).
        bg: {
          DEFAULT: "#0E0E11", // app base
          card: "#151519", // rows at rest
          raised: "#1B1B21", // menus, bars, hover surfaces
          hover: "#232330", // interactive hover
        },
        fg: {
          DEFAULT: "#ECECF1",
          muted: "#8A8A97",
          faint: "#5C5C68", // metadata, disabled
        },
        // One confident hue — iris — used sparingly for focus/active/primary/privacy.
        accent: {
          DEFAULT: "#7B61FF",
          hover: "#8E77FF",
          dim: "#221E3C", // low-tint surface for selected/active backgrounds
        },
        border: {
          DEFAULT: "#26262E", // hairline
          strong: "#343440",
        },
      },
      fontFamily: {
        sans: ['"Space Grotesk Variable"', "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ['"JetBrains Mono Variable"', "ui-monospace", "SFMono-Regular", "monospace"],
      },
      keyframes: {
        "row-in": {
          "0%": { opacity: "0", transform: "translateY(4px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "pop-check": {
          "0%": { opacity: "0", transform: "scale(0.8)" },
          "60%": { transform: "scale(1.08)" },
          "100%": { opacity: "1", transform: "scale(1)" },
        },
        "fade-in-up": {
          "0%": { opacity: "0", transform: "translateY(6px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "row-in": "row-in 0.18s ease-out both",
        "pop-check": "pop-check 0.22s ease-out both",
        "fade-in-up": "fade-in-up 0.2s ease-out both",
      },
    },
  },
  plugins: [],
};
