import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDatabase, databaseUrlFromEnvironment } from "../persistence/database.js";

const database = createDatabase(databaseUrlFromEnvironment());
try {
  await migrate(database.db, { migrationsFolder: "drizzle" });
  console.log("Database migrations applied.");
} finally {
  await database.close();
}
