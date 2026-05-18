import { defineConfig } from "vite";

export default defineConfig(({ mode }) => {
  if (mode === "development") {
    return {
      server: {
        port: 5175,
        proxy: {
          "/api": {
            target: "http://localhost:3002",
            changeOrigin: true,
          },
        },
      },
    };
  }

  return {
    build: {
      lib: {
        entry: "src/index.ts",
        name: "LoyaltyWidget",
        formats: ["iife", "es"],
        fileName: (format) => `loyalty-widget.${format}.js`,
      },
    },
  };
});
