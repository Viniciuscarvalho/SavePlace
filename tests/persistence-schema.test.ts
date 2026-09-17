import { getTableColumns, getTableName } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { databaseUrlFromEnvironment } from "../src/persistence/database.js";
import {
  idempotencyOperations,
  places,
  sourceAliases,
  sourceAnalyses,
  sources,
  userPlaces,
} from "../src/persistence/schema.js";

describe("M1 persistence schema", () => {
  it("keeps the cache, provider identity and explicit save boundaries separate", () => {
    expect(getTableName(sources)).toBe("sources");
    expect(getTableName(sourceAliases)).toBe("source_aliases");
    expect(getTableName(sourceAnalyses)).toBe("source_analyses");
    expect(getTableName(places)).toBe("places");
    expect(getTableName(userPlaces)).toBe("user_places");
    expect(getTableName(idempotencyOperations)).toBe("idempotency_operations");

    expect(getTableColumns(sourceAliases)).toHaveProperty("normalizedUrl");
    expect(getTableColumns(sourceAnalyses)).toHaveProperty("providerConfigFingerprint");
    expect(getTableColumns(places)).toHaveProperty("providerPlaceId");
    expect(getTableColumns(userPlaces)).toHaveProperty("placeId");
    expect(getTableColumns(idempotencyOperations)).toHaveProperty("requestHash");
    expect(getTableConfig(sources).indexes.map((index) => index.config.name))
      .toContain("sources_platform_canonical_url_key");
  });

  it("requires a PostgreSQL connection string only when database access is initialized", () => {
    expect(() => databaseUrlFromEnvironment({})).toThrow("DATABASE_URL must be set.");
    expect(() => databaseUrlFromEnvironment({ DATABASE_URL: "mysql://localhost/saveplace" })).toThrow("DATABASE_URL must use the postgres or postgresql protocol.");
    expect(databaseUrlFromEnvironment({ DATABASE_URL: "postgresql://user:password@localhost:5432/saveplace" }))
      .toBe("postgresql://user:password@localhost:5432/saveplace");
  });
});
