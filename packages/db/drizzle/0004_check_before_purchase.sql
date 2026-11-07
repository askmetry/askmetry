ALTER TABLE "check_request" ADD COLUMN "topics" text[];--> statement-breakpoint
ALTER TABLE "check_request" ADD COLUMN "prompts" text[];--> statement-breakpoint
ALTER TABLE "check_request" ADD COLUMN "marketing_consent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "check_request" ADD COLUMN "marketing_consent_version" text;--> statement-breakpoint
ALTER TABLE "check_request" ADD COLUMN "reminder_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "check_request" ADD COLUMN "progress_seen_at" timestamp with time zone;