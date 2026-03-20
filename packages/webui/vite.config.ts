import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"

export default defineConfig({
  plugins: [react()],
  base: "/",
  server: {
    proxy: {
      "/api": "http://localhost:18888",
      "/ws": { target: "ws://localhost:18888", ws: true },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
})
