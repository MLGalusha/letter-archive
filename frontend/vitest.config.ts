import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    css: true,
    // JSDOM-heavy component files become slower than their 5s behavioral
    // timeout when every logical CPU hosts a worker. Keep the gate
    // machine-relative so CI and local runs exercise real timing assertions
    // without oversubscribing the host.
    maxWorkers: "25%",
  },
});
