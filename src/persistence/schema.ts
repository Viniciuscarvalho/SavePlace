import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import type { AnalysisResult, Evidence, PlaceCandidate, ProviderUsage } from "../domain/models.js";

const timestampColumns = {
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
};

export const platformEnum = pgEnum("platform", ["youtube", "instagram", "tiktok", "web", "unknown"]);
export const analysisStatusEnum = pgEnum("analysis_status", ["queued", "processing", "completed", "insufficient_evidence", "needs_review", "failed"]);
export const userPlaceStatusEnum = pgEnum("user_place_status", ["want_to_go", "visited"]);
export const idempotencyStateEnum = pgEnum("idempotency_state", ["processing", "completed", "failed"]);

/** A future authentication provider owns the external identity; M1 keeps the boundary in the schema. */
export const users = pgTable("users", {
  id: varchar("id", { length: 128 }).primaryKey(),
  ...timestampColumns,
});

/** An opaque browser token is stored only as a hash and resolves a private user scope. */
export const sessions = pgTable("sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: varchar("user_id", { length: 128 }).notNull().references(() => users.id, { onDelete: "cascade" }),
  tokenHash: varchar("token_hash", { length: 64 }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  ...timestampColumns,
}, (table) => [
  uniqueIndex("sessions_token_hash_key").on(table.tokenHash),
  index("sessions_user_id_idx").on(table.userId),
  index("sessions_expires_at_idx").on(table.expiresAt),
]);

/** One canonical social source, independent from the URL aliases a user submitted. */
export const sources = pgTable("sources", {
  id: uuid("id").defaultRandom().primaryKey(),
  platform: platformEnum("platform").notNull(),
  canonicalUrl: text("canonical_url").notNull(),
  canonicalContentId: varchar("canonical_content_id", { length: 255 }),
  author: text("author"),
  title: text("title"),
  description: text("description"),
  thumbnailUrl: text("thumbnail_url"),
  ...timestampColumns,
}, (table) => [
  uniqueIndex("sources_platform_canonical_url_key").on(table.platform, table.canonicalUrl),
  uniqueIndex("sources_platform_content_id_key")
    .on(table.platform, table.canonicalContentId)
    .where(sql`${table.canonicalContentId} is not null`),
]);

/** An exact submitted URL can hit this alias cache before another platform request. */
export const sourceAliases = pgTable("source_aliases", {
  id: uuid("id").defaultRandom().primaryKey(),
  sourceId: uuid("source_id").notNull().references(() => sources.id, { onDelete: "cascade" }),
  normalizedUrl: text("normalized_url").notNull(),
  originalUrl: text("original_url").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("source_aliases_normalized_url_key").on(table.normalizedUrl),
  index("source_aliases_source_id_idx").on(table.sourceId),
]);

/** One attributed result per source and executable pipeline configuration. */
export const sourceAnalyses = pgTable("source_analyses", {
  id: uuid("id").defaultRandom().primaryKey(),
  sourceId: uuid("source_id").notNull().references(() => sources.id, { onDelete: "cascade" }),
  pipelineVersion: varchar("pipeline_version", { length: 128 }).notNull(),
  providerConfigFingerprint: varchar("provider_config_fingerprint", { length: 128 }).notNull(),
  status: analysisStatusEnum("status").notNull(),
  result: jsonb("result").$type<AnalysisResult>().notNull(),
  providerUsage: jsonb("provider_usage").$type<ProviderUsage[]>().notNull(),
  ...timestampColumns,
}, (table) => [
  uniqueIndex("source_analyses_cache_key")
    .on(table.sourceId, table.pipelineVersion, table.providerConfigFingerprint),
  index("source_analyses_source_id_idx").on(table.sourceId),
]);

/** A private user's history points to a globally cacheable source analysis. */
export const userAnalyses = pgTable("user_analyses", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: varchar("user_id", { length: 128 }).notNull().references(() => users.id, { onDelete: "cascade" }),
  analysisId: uuid("analysis_id").notNull().references(() => sourceAnalyses.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("user_analyses_user_analysis_key").on(table.userId, table.analysisId),
  index("user_analyses_user_id_idx").on(table.userId),
  index("user_analyses_analysis_id_idx").on(table.analysisId),
]);

/** A provider-owned geographical identity. It is the only durable verified-place identity. */
export const places = pgTable("places", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  normalizedName: text("normalized_name").notNull(),
  category: varchar("category", { length: 32 }).notNull(),
  subcategory: text("subcategory"),
  address: text("address").notNull(),
  city: text("city").notNull(),
  state: text("state"),
  country: text("country").notNull(),
  latitude: numeric("latitude", { precision: 10, scale: 7 }).notNull(),
  longitude: numeric("longitude", { precision: 10, scale: 7 }).notNull(),
  provider: varchar("provider", { length: 128 }).notNull(),
  providerPlaceId: varchar("provider_place_id", { length: 255 }).notNull(),
  ...timestampColumns,
}, (table) => [
  uniqueIndex("places_provider_place_id_key").on(table.provider, table.providerPlaceId),
]);

/** A candidate may remain unresolved, so its `placeId` is deliberately nullable. */
export const placeMentions = pgTable("place_mentions", {
  id: uuid("id").defaultRandom().primaryKey(),
  analysisId: uuid("analysis_id").notNull().references(() => sourceAnalyses.id, { onDelete: "cascade" }),
  placeId: uuid("place_id").references(() => places.id, { onDelete: "set null" }),
  candidate: jsonb("candidate").$type<PlaceCandidate>().notNull(),
  evidence: jsonb("evidence").$type<Evidence[]>().notNull(),
  extractionConfidence: numeric("extraction_confidence", { precision: 4, scale: 3 }).notNull(),
  resolutionConfidence: numeric("resolution_confidence", { precision: 4, scale: 3 }),
  overallConfidence: numeric("overall_confidence", { precision: 4, scale: 3 }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("place_mentions_analysis_id_idx").on(table.analysisId),
  index("place_mentions_place_id_idx").on(table.placeId),
]);

/** A durable library record appears only after a user confirms a verified place. */
export const userPlaces = pgTable("user_places", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: varchar("user_id", { length: 128 }).notNull().references(() => users.id, { onDelete: "cascade" }),
  placeId: uuid("place_id").notNull().references(() => places.id, { onDelete: "cascade" }),
  status: userPlaceStatusEnum("status").notNull().default("want_to_go"),
  favorite: boolean("favorite").notNull().default(false),
  notes: text("notes"),
  ...timestampColumns,
}, (table) => [
  uniqueIndex("user_places_user_place_key").on(table.userId, table.placeId),
  index("user_places_user_id_idx").on(table.userId),
]);

/** A per-user counter guards uncached pipeline starts without retaining URLs or provider payloads. */
export const userAnalysisUsage = pgTable("user_analysis_usage", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: varchar("user_id", { length: 128 }).notNull().references(() => users.id, { onDelete: "cascade" }),
  period: varchar("period", { length: 7 }).notNull(),
  analysisCount: integer("analysis_count").notNull().default(0),
  ...timestampColumns,
}, (table) => [
  uniqueIndex("user_analysis_usage_user_period_key").on(table.userId, table.period),
]);

/** Observability events intentionally omit user, URL, evidence and provider payload data. */
export const analysisMetrics = pgTable("analysis_metrics", {
  id: uuid("id").defaultRandom().primaryKey(),
  period: varchar("period", { length: 7 }).notNull(),
  cache: varchar("cache", { length: 16 }).notNull(),
  durationMs: integer("duration_ms").notNull(),
  estimatedCostUsd: numeric("estimated_cost_usd", { precision: 14, scale: 6 }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("analysis_metrics_period_idx").on(table.period),
]);

/** Retries return their first response rather than repeat a paid analysis. */
export const idempotencyOperations = pgTable("idempotency_operations", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: varchar("user_id", { length: 128 }).notNull().references(() => users.id, { onDelete: "cascade" }),
  idempotencyKey: varchar("idempotency_key", { length: 255 }).notNull(),
  requestHash: varchar("request_hash", { length: 128 }).notNull(),
  state: idempotencyStateEnum("state").notNull(),
  responseStatus: integer("response_status"),
  responseBody: jsonb("response_body").$type<Record<string, unknown>>(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  ...timestampColumns,
}, (table) => [
  uniqueIndex("idempotency_operations_user_key").on(table.userId, table.idempotencyKey),
  index("idempotency_operations_expires_at_idx").on(table.expiresAt),
]);

/** M1 replaces the M0 per-process cost guard with a durable period ledger. */
export const providerUsageLedger = pgTable("provider_usage_ledger", {
  id: uuid("id").defaultRandom().primaryKey(),
  provider: varchar("provider", { length: 128 }).notNull(),
  operation: varchar("operation", { length: 128 }).notNull(),
  billingPeriod: varchar("billing_period", { length: 7 }).notNull(),
  requestCount: integer("request_count").notNull().default(0),
  billableUnits: integer("billable_units").notNull().default(0),
  estimatedCostUsd: numeric("estimated_cost_usd", { precision: 14, scale: 6 }),
  ...timestampColumns,
}, (table) => [
  uniqueIndex("provider_usage_ledger_period_key").on(table.provider, table.operation, table.billingPeriod),
]);
