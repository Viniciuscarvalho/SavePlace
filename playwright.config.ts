import { defineConfig } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3107";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  use: { baseURL, trace: "retain-on-failure" },
  ...(process.env.PLAYWRIGHT_BASE_URL ? {} : {
    webServer: {
      command: "npm run dev -- --port 3107",
      url: baseURL,
      reuseExistingServer: !process.env.CI,
    },
  }),
});
