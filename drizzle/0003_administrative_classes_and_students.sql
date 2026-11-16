CREATE TYPE "enrollment_status" AS ENUM('enrolled', 'suspended', 'transferred', 'graduated');--> statement-breakpoint
CREATE TABLE "administrative_classes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "administrative_classes_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "students" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_number" text NOT NULL,
	"name" text NOT NULL,
	"administrative_class_id" uuid NOT NULL,
	"enrollment_status" "enrollment_status" DEFAULT 'enrolled' NOT NULL,
	"account_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "students_student_number_unique" UNIQUE("student_number")
);
--> statement-breakpoint
ALTER TABLE "students" ADD CONSTRAINT "students_administrative_class_id_administrative_classes_id_fk" FOREIGN KEY ("administrative_class_id") REFERENCES "administrative_classes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "students" ADD CONSTRAINT "students_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "students_administrative_class_id_idx" ON "students" USING btree ("administrative_class_id");--> statement-breakpoint
CREATE UNIQUE INDEX "students_account_id_unique" ON "students" USING btree ("account_id");