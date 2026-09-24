CREATE TABLE "analysis_metrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"period" varchar(7) NOT NULL,
	"cache" varchar(16) NOT NULL,
	"duration_ms" integer NOT NULL,
	"estimated_cost_usd" numeric(14, 6),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_analysis_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar(128) NOT NULL,
	"period" varchar(7) NOT NULL,
	"analysis_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_analysis_usage" ADD CONSTRAINT "user_analysis_usage_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "analysis_metrics_period_idx" ON "analysis_metrics" USING btree ("period");--> statement-breakpoint
CREATE UNIQUE INDEX "user_analysis_usage_user_period_key" ON "user_analysis_usage" USING btree ("user_id","period");
