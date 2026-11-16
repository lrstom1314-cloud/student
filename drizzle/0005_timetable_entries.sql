CREATE TYPE "week_parity" AS ENUM('every', 'odd', 'even');--> statement-breakpoint
CREATE TABLE "timetable_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"teaching_class_id" uuid NOT NULL,
	"weekday" integer NOT NULL,
	"start_period" integer NOT NULL,
	"end_period" integer NOT NULL,
	"start_week" integer NOT NULL,
	"end_week" integer NOT NULL,
	"week_parity" "week_parity" NOT NULL,
	"classroom" text NOT NULL,
	"conflict_acknowledged_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "timetable_entries_weekday_range" CHECK ("timetable_entries"."weekday" between 1 and 7),
	CONSTRAINT "timetable_entries_period_range" CHECK ("timetable_entries"."start_period" >= 1 and "timetable_entries"."end_period" >= "timetable_entries"."start_period" and "timetable_entries"."end_period" <= 20),
	CONSTRAINT "timetable_entries_week_range" CHECK ("timetable_entries"."start_week" >= 1 and "timetable_entries"."end_week" >= "timetable_entries"."start_week" and "timetable_entries"."end_week" <= 30),
	CONSTRAINT "timetable_entries_classroom_not_blank" CHECK (length(btrim("timetable_entries"."classroom")) > 0)
);
--> statement-breakpoint
ALTER TABLE "timetable_entries" ADD CONSTRAINT "timetable_entries_teaching_class_id_teaching_classes_id_fk" FOREIGN KEY ("teaching_class_id") REFERENCES "teaching_classes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "timetable_entries_teaching_class_id_idx" ON "timetable_entries" USING btree ("teaching_class_id");--> statement-breakpoint
CREATE INDEX "timetable_entries_weekday_idx" ON "timetable_entries" USING btree ("weekday");