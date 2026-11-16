CREATE TYPE "teaching_class_student_source" AS ENUM('whole_class', 'manual');--> statement-breakpoint
CREATE TABLE "courses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"credits" numeric(4, 1),
	"hours" integer,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "courses_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "teaching_class_students" (
	"teaching_class_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"source" "teaching_class_student_source" NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "teaching_class_students_teaching_class_id_student_id_pk" PRIMARY KEY("teaching_class_id","student_id")
);
--> statement-breakpoint
CREATE TABLE "teaching_classes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"term_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"teacher_account_id" uuid NOT NULL,
	"display_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "teaching_class_students" ADD CONSTRAINT "teaching_class_students_teaching_class_id_teaching_classes_id_fk" FOREIGN KEY ("teaching_class_id") REFERENCES "teaching_classes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teaching_class_students" ADD CONSTRAINT "teaching_class_students_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teaching_classes" ADD CONSTRAINT "teaching_classes_term_id_terms_id_fk" FOREIGN KEY ("term_id") REFERENCES "terms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teaching_classes" ADD CONSTRAINT "teaching_classes_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teaching_classes" ADD CONSTRAINT "teaching_classes_teacher_account_id_accounts_id_fk" FOREIGN KEY ("teacher_account_id") REFERENCES "accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "teaching_class_students_student_id_idx" ON "teaching_class_students" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "teaching_classes_term_id_idx" ON "teaching_classes" USING btree ("term_id");--> statement-breakpoint
CREATE INDEX "teaching_classes_course_id_idx" ON "teaching_classes" USING btree ("course_id");--> statement-breakpoint
CREATE INDEX "teaching_classes_teacher_account_id_idx" ON "teaching_classes" USING btree ("teacher_account_id");