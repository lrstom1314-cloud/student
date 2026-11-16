CREATE TYPE "term_half" AS ENUM('first', 'second');--> statement-breakpoint
CREATE TABLE "academic_years" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"start_year" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "academic_years_start_year_unique" UNIQUE("start_year")
);
--> statement-breakpoint
CREATE TABLE "term_settings" (
	"id" text PRIMARY KEY DEFAULT 'singleton' NOT NULL,
	"current_term_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "term_settings_singleton" CHECK ("term_settings"."id" = 'singleton')
);
--> statement-breakpoint
CREATE TABLE "terms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"academic_year_id" uuid NOT NULL,
	"half" "term_half" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "term_settings" ADD CONSTRAINT "term_settings_current_term_id_terms_id_fk" FOREIGN KEY ("current_term_id") REFERENCES "terms"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "terms" ADD CONSTRAINT "terms_academic_year_id_academic_years_id_fk" FOREIGN KEY ("academic_year_id") REFERENCES "academic_years"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "terms_academic_year_id_half_unique" ON "terms" USING btree ("academic_year_id","half");--> statement-breakpoint
CREATE INDEX "terms_academic_year_id_idx" ON "terms" USING btree ("academic_year_id");