CREATE TYPE "teaching_class_grade_state" AS ENUM('draft', 'published');--> statement-breakpoint
ALTER TYPE "grade_change_target" ADD VALUE 'teaching_class';--> statement-breakpoint
CREATE TABLE "grade_publication_items" (
	"publication_id" uuid NOT NULL,
	"grade_item_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"name" text NOT NULL,
	"max_score" numeric(6, 2) NOT NULL,
	"weight" numeric(5, 2) NOT NULL,
	CONSTRAINT "grade_publication_items_publication_id_grade_item_id_pk" PRIMARY KEY("publication_id","grade_item_id"),
	CONSTRAINT "grade_publication_items_max_score_positive" CHECK ("grade_publication_items"."max_score" > 0),
	CONSTRAINT "grade_publication_items_weight_range" CHECK ("grade_publication_items"."weight" > 0 and "grade_publication_items"."weight" <= 100),
	CONSTRAINT "grade_publication_items_position_non_negative" CHECK ("grade_publication_items"."position" >= 0)
);
--> statement-breakpoint
CREATE TABLE "grade_publication_overalls" (
	"publication_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"student_number" text NOT NULL,
	"student_name" text NOT NULL,
	"computed_score" numeric(8, 2),
	"override_score" numeric(8, 2),
	"final_score" numeric(8, 2),
	"final_source" text,
	"status" text NOT NULL,
	CONSTRAINT "grade_publication_overalls_publication_id_student_id_pk" PRIMARY KEY("publication_id","student_id"),
	CONSTRAINT "grade_publication_overalls_final_source_valid" CHECK ("grade_publication_overalls"."final_source" is null or "grade_publication_overalls"."final_source" in ('computed', 'override')),
	CONSTRAINT "grade_publication_overalls_status_valid" CHECK ("grade_publication_overalls"."status" in ('complete', 'incomplete')),
	CONSTRAINT "grade_publication_overalls_scores_non_negative" CHECK (("grade_publication_overalls"."computed_score" is null or "grade_publication_overalls"."computed_score" >= 0)
        and ("grade_publication_overalls"."override_score" is null or "grade_publication_overalls"."override_score" >= 0)
        and ("grade_publication_overalls"."final_score" is null or "grade_publication_overalls"."final_score" >= 0))
);
--> statement-breakpoint
CREATE TABLE "grade_publication_scores" (
	"publication_id" uuid NOT NULL,
	"grade_item_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"score" numeric(6, 2) NOT NULL,
	CONSTRAINT "grade_publication_scores_publication_id_grade_item_id_student_id_pk" PRIMARY KEY("publication_id","grade_item_id","student_id"),
	CONSTRAINT "grade_publication_scores_score_non_negative" CHECK ("grade_publication_scores"."score" >= 0)
);
--> statement-breakpoint
CREATE TABLE "grade_publications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"teaching_class_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"published_by" uuid NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "grade_change_logs" ALTER COLUMN "student_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "teaching_classes" ADD COLUMN "grade_state" "teaching_class_grade_state" DEFAULT 'draft' NOT NULL;--> statement-breakpoint
ALTER TABLE "grade_publication_items" ADD CONSTRAINT "grade_publication_items_publication_id_grade_publications_id_fk" FOREIGN KEY ("publication_id") REFERENCES "grade_publications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grade_publication_overalls" ADD CONSTRAINT "grade_publication_overalls_publication_id_grade_publications_id_fk" FOREIGN KEY ("publication_id") REFERENCES "grade_publications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grade_publication_overalls" ADD CONSTRAINT "grade_publication_overalls_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grade_publication_scores" ADD CONSTRAINT "grade_publication_scores_publication_id_grade_publications_id_fk" FOREIGN KEY ("publication_id") REFERENCES "grade_publications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grade_publication_scores" ADD CONSTRAINT "grade_publication_scores_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grade_publications" ADD CONSTRAINT "grade_publications_teaching_class_id_teaching_classes_id_fk" FOREIGN KEY ("teaching_class_id") REFERENCES "teaching_classes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grade_publications" ADD CONSTRAINT "grade_publications_published_by_accounts_id_fk" FOREIGN KEY ("published_by") REFERENCES "accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "grade_publication_items_publication_position_unique" ON "grade_publication_items" USING btree ("publication_id","position");--> statement-breakpoint
CREATE INDEX "grade_publication_overalls_student_id_idx" ON "grade_publication_overalls" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "grade_publication_scores_student_id_idx" ON "grade_publication_scores" USING btree ("student_id");--> statement-breakpoint
CREATE UNIQUE INDEX "grade_publications_teaching_class_id_version_unique" ON "grade_publications" USING btree ("teaching_class_id","version");--> statement-breakpoint
CREATE INDEX "grade_publications_teaching_class_id_idx" ON "grade_publications" USING btree ("teaching_class_id");--> statement-breakpoint
ALTER TABLE "grade_change_logs" ADD CONSTRAINT "grade_change_logs_target_student" CHECK (("grade_change_logs"."target"::text = 'teaching_class' and "grade_change_logs"."student_id" is null)
        or ("grade_change_logs"."target"::text <> 'teaching_class' and "grade_change_logs"."student_id" is not null));