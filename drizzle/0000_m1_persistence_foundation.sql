CREATE TYPE "public"."analysis_status" AS ENUM('queued', 'processing', 'completed', 'insufficient_evidence', 'needs_review', 'failed');--> statement-breakpoint
CREATE TYPE "public"."idempotency_state" AS ENUM('processing', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."platform" AS ENUM('youtube', 'instagram', 'tiktok', 'web', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."user_place_status" AS ENUM('want_to_go', 'visited');--> statement-breakpoint
CREATE TABLE "idempotency_operations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar(128) NOT NULL,
	"idempotency_key" varchar(255) NOT NULL,
	"request_hash" varchar(128) NOT NULL,
	"state" "idempotency_state" NOT NULL,
	"response_status" integer,
	"response_body" jsonb,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "place_mentions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"analysis_id" uuid NOT NULL,
	"place_id" uuid,
	"candidate" jsonb NOT NULL,
	"evidence" jsonb NOT NULL,
	"extraction_confidence" numeric(4, 3) NOT NULL,
	"resolution_confidence" numeric(4, 3),
	"overall_confidence" numeric(4, 3),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "places" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"category" varchar(32) NOT NULL,
	"subcategory" text,
	"address" text NOT NULL,
	"city" text NOT NULL,
	"state" text,
	"country" text NOT NULL,
	"latitude" numeric(10, 7) NOT NULL,
	"longitude" numeric(10, 7) NOT NULL,
	"provider" varchar(128) NOT NULL,
	"provider_place_id" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_usage_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" varchar(128) NOT NULL,
	"operation" varchar(128) NOT NULL,
	"billing_period" varchar(7) NOT NULL,
	"request_count" integer DEFAULT 0 NOT NULL,
	"billable_units" integer DEFAULT 0 NOT NULL,
	"estimated_cost_usd" numeric(14, 6),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_aliases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"normalized_url" text NOT NULL,
	"original_url" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_analyses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"pipeline_version" varchar(128) NOT NULL,
	"provider_config_fingerprint" varchar(128) NOT NULL,
	"status" "analysis_status" NOT NULL,
	"result" jsonb NOT NULL,
	"provider_usage" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"platform" "platform" NOT NULL,
	"canonical_url" text NOT NULL,
	"canonical_content_id" varchar(255),
	"author" text,
	"title" text,
	"description" text,
	"thumbnail_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_places" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar(128) NOT NULL,
	"place_id" uuid NOT NULL,
	"status" "user_place_status" DEFAULT 'want_to_go' NOT NULL,
	"favorite" boolean DEFAULT false NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" varchar(128) PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "idempotency_operations" ADD CONSTRAINT "idempotency_operations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "place_mentions" ADD CONSTRAINT "place_mentions_analysis_id_source_analyses_id_fk" FOREIGN KEY ("analysis_id") REFERENCES "public"."source_analyses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "place_mentions" ADD CONSTRAINT "place_mentions_place_id_places_id_fk" FOREIGN KEY ("place_id") REFERENCES "public"."places"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_aliases" ADD CONSTRAINT "source_aliases_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_analyses" ADD CONSTRAINT "source_analyses_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_places" ADD CONSTRAINT "user_places_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_places" ADD CONSTRAINT "user_places_place_id_places_id_fk" FOREIGN KEY ("place_id") REFERENCES "public"."places"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idempotency_operations_user_key" ON "idempotency_operations" USING btree ("user_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "idempotency_operations_expires_at_idx" ON "idempotency_operations" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "place_mentions_analysis_id_idx" ON "place_mentions" USING btree ("analysis_id");--> statement-breakpoint
CREATE INDEX "place_mentions_place_id_idx" ON "place_mentions" USING btree ("place_id");--> statement-breakpoint
CREATE UNIQUE INDEX "places_provider_place_id_key" ON "places" USING btree ("provider","provider_place_id");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_usage_ledger_period_key" ON "provider_usage_ledger" USING btree ("provider","operation","billing_period");--> statement-breakpoint
CREATE UNIQUE INDEX "source_aliases_normalized_url_key" ON "source_aliases" USING btree ("normalized_url");--> statement-breakpoint
CREATE INDEX "source_aliases_source_id_idx" ON "source_aliases" USING btree ("source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "source_analyses_cache_key" ON "source_analyses" USING btree ("source_id","pipeline_version","provider_config_fingerprint");--> statement-breakpoint
CREATE INDEX "source_analyses_source_id_idx" ON "source_analyses" USING btree ("source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sources_platform_content_id_key" ON "sources" USING btree ("platform","canonical_content_id") WHERE "sources"."canonical_content_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "user_places_user_place_key" ON "user_places" USING btree ("user_id","place_id");--> statement-breakpoint
CREATE INDEX "user_places_user_id_idx" ON "user_places" USING btree ("user_id");