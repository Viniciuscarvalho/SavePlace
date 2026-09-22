CREATE TABLE "user_analyses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar(128) NOT NULL,
	"analysis_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_analyses" ADD CONSTRAINT "user_analyses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_analyses" ADD CONSTRAINT "user_analyses_analysis_id_source_analyses_id_fk" FOREIGN KEY ("analysis_id") REFERENCES "public"."source_analyses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "user_analyses_user_analysis_key" ON "user_analyses" USING btree ("user_id","analysis_id");--> statement-breakpoint
CREATE INDEX "user_analyses_user_id_idx" ON "user_analyses" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_analyses_analysis_id_idx" ON "user_analyses" USING btree ("analysis_id");
