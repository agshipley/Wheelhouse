import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  preview: {
    port: parseInt(process.env.PORT) || 4173,
    host: true,
    allowedHosts: ["wheelhouse-production-f59a.up.railway.app"],
  },
});
