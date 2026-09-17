import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/persistence/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    // `generate` does not contact this URL. `db:migrate` requires DATABASE_URL.
    url: process.env.DATABASE_URL ?? "postgresql://saveplace:saveplace@localhost:5432/saveplace",
  },
});
