CREATE TYPE "grade_change_action" AS ENUM('record', 'update', 'override_overall', 'cancel_override', 'publish', 'unlock');--> statement-breakpoint
CREATE TYPE "grade_change_target" AS ENUM('grade_item', 'overall');--> statement-breakpoint
CREATE TABLE "grade_change_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"teaching_class_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"grade_item_id" uuid,
	"target" "grade_change_target" NOT NULL,
	"action" "grade_change_action" NOT NULL,
	"actor_account_id" uuid NOT NULL,
	"old_value" numeric(8, 2),
	"new_value" numeric(8, 2),
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "grade_change_logs_target_item" CHECK ("grade_change_logs"."target" = 'grade_item' or "grade_change_logs"."grade_item_id" is null)
);
--> statement-breakpoint
CREATE TABLE "grade_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"teaching_class_id" uuid NOT NULL,
	"name" text NOT NULL,
	"max_score" numeric(6, 2) NOT NULL,
	"weight" numeric(5, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "grade_items_max_score_positive" CHECK ("grade_items"."max_score" > 0),
	CONSTRAINT "grade_items_weight_range" CHECK ("grade_items"."weight" > 0 and "grade_items"."weight" <= 100)
);
--> statement-breakpoint
CREATE TABLE "grade_overalls" (
	"teaching_class_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"computed_score" numeric(8, 2),
	"computed_at" timestamp with time zone,
	"override_score" numeric(8, 2),
	"override_updated_at" timestamp with time zone,
	"override_updated_by" uuid,
	CONSTRAINT "grade_overalls_teaching_class_id_student_id_pk" PRIMARY KEY("teaching_class_id","student_id"),
	CONSTRAINT "grade_overalls_scores_non_negative" CHECK (("grade_overalls"."computed_score" is null or "grade_overalls"."computed_score" >= 0)
        and ("grade_overalls"."override_score" is null or "grade_overalls"."override_score" >= 0))
);
--> statement-breakpoint
CREATE TABLE "student_grades" (
	"grade_item_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"score" numeric(6, 2) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "student_grades_grade_item_id_student_id_pk" PRIMARY KEY("grade_item_id","student_id"),
	CONSTRAINT "student_grades_score_non_negative" CHECK ("student_grades"."score" >= 0)
);
--> statement-breakpoint
ALTER TABLE "grade_change_logs" ADD CONSTRAINT "grade_change_logs_teaching_class_id_teaching_classes_id_fk" FOREIGN KEY ("teaching_class_id") REFERENCES "teaching_classes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grade_change_logs" ADD CONSTRAINT "grade_change_logs_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grade_change_logs" ADD CONSTRAINT "grade_change_logs_grade_item_id_grade_items_id_fk" FOREIGN KEY ("grade_item_id") REFERENCES "grade_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grade_change_logs" ADD CONSTRAINT "grade_change_logs_actor_account_id_accounts_id_fk" FOREIGN KEY ("actor_account_id") REFERENCES "accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grade_items" ADD CONSTRAINT "grade_items_teaching_class_id_teaching_classes_id_fk" FOREIGN KEY ("teaching_class_id") REFERENCES "teaching_classes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grade_overalls" ADD CONSTRAINT "grade_overalls_teaching_class_id_teaching_classes_id_fk" FOREIGN KEY ("teaching_class_id") REFERENCES "teaching_classes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grade_overalls" ADD CONSTRAINT "grade_overalls_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grade_overalls" ADD CONSTRAINT "grade_overalls_override_updated_by_accounts_id_fk" FOREIGN KEY ("override_updated_by") REFERENCES "accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_grades" ADD CONSTRAINT "student_grades_grade_item_id_grade_items_id_fk" FOREIGN KEY ("grade_item_id") REFERENCES "grade_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_grades" ADD CONSTRAINT "student_grades_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "grade_change_logs_teaching_class_id_idx" ON "grade_change_logs" USING btree ("teaching_class_id","created_at");--> statement-breakpoint
CREATE INDEX "grade_change_logs_student_id_idx" ON "grade_change_logs" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "grade_change_logs_actor_account_id_idx" ON "grade_change_logs" USING btree ("actor_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "grade_items_teaching_class_id_name_unique" ON "grade_items" USING btree ("teaching_class_id","name");--> statement-breakpoint
CREATE INDEX "grade_items_teaching_class_id_idx" ON "grade_items" USING btree ("teaching_class_id");--> statement-breakpoint
CREATE INDEX "grade_overalls_student_id_idx" ON "grade_overalls" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "student_grades_student_id_idx" ON "student_grades" USING btree ("student_id");