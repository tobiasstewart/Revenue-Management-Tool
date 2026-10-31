import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        brand: { DEFAULT: "#0D8585", dark: "#0A6B6B", light: "#E0F2F1" },
        accent: "#2E75B6",
        negative: "#DC2626",
        row: "#F5F7FA",
        page: "#EEF2F7",
      },
    },
  },
  plugins: [],
};
export default config;
