import { getTableColumns, getTableName } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { databaseUrlFromEnvironment } from "../src/persistence/database.js";
import {
  analysisMetrics,
  idempotencyOperations,
  places,
  sourceAliases,
  sourceAnalyses,
  sources,
  sessions,
  userAnalyses,
  userAnalysisUsage,
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
    expect(getTableName(sessions)).toBe("sessions");
    expect(getTableName(userAnalyses)).toBe("user_analyses");
    expect(getTableName(userAnalysisUsage)).toBe("user_analysis_usage");
    expect(getTableName(analysisMetrics)).toBe("analysis_metrics");

    expect(getTableColumns(sourceAliases)).toHaveProperty("normalizedUrl");
    expect(getTableColumns(sourceAnalyses)).toHaveProperty("providerConfigFingerprint");
    expect(getTableColumns(places)).toHaveProperty("providerPlaceId");
    expect(getTableColumns(userPlaces)).toHaveProperty("placeId");
    expect(getTableColumns(idempotencyOperations)).toHaveProperty("requestHash");
    expect(getTableColumns(sessions)).toHaveProperty("tokenHash");
    expect(getTableColumns(userAnalyses)).toHaveProperty("analysisId");
    expect(getTableColumns(userAnalysisUsage)).toHaveProperty("analysisCount");
    expect(getTableColumns(analysisMetrics)).toHaveProperty("estimatedCostUsd");
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
