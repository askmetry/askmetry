CREATE TABLE "funnel_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"check_id" uuid,
	"report_id" uuid,
	"workspace_id" uuid,
	"user_id" text,
	"props" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mail_opt_out" (
	"email" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"tier" text NOT NULL,
	"kind" text DEFAULT 'initial' NOT NULL,
	"status" text DEFAULT 'pending_payment' NOT NULL,
	"previous_report_id" uuid,
	"check_id" uuid,
	"payment_provider" text DEFAULT 'stripe' NOT NULL,
	"checkout_session_id" text,
	"payment_intent_id" text,
	"invoice_id" text,
	"amount_cents" integer NOT NULL,
	"currency" text DEFAULT 'eur' NOT NULL,
	"b2b_confirmed_at" timestamp with time zone,
	"terms_accepted_at" timestamp with time zone,
	"terms_version" text,
	"collection_id" uuid,
	"cost_usd" numeric(10, 4) DEFAULT '0' NOT NULL,
	"error" text,
	"paid_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"ready_at" timestamp with time zone,
	"pdf_generated_at" timestamp with time zone,
	"emailed_at" timestamp with time zone,
	"reminded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "report_checkout_session_id_unique" UNIQUE("checkout_session_id")
);
--> statement-breakpoint
CREATE TABLE "report_file" (
	"report_id" uuid PRIMARY KEY NOT NULL,
	"content_type" text DEFAULT 'application/pdf' NOT NULL,
	"data" text NOT NULL,
	"bytes" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "check_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token" text NOT NULL,
	"url" text NOT NULL,
	"domain" text NOT NULL,
	"locale" text DEFAULT 'de' NOT NULL,
	"status" text DEFAULT 'discovering' NOT NULL,
	"email" text,
	"verify_code_hash" text,
	"verify_sent_at" timestamp with time zone,
	"email_verified_at" timestamp with time zone,
	"ip_hash" text,
	"workspace_id" uuid,
	"collection_id" uuid,
	"reused_from_id" uuid,
	"cost_usd" numeric(10, 4) DEFAULT '0' NOT NULL,
	"error" text,
	"summary" jsonb,
	"ready_at" timestamp with time zone,
	"ready_mail_sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "check_request_token_unique" UNIQUE("token")
);
--> statement-breakpoint
ALTER TABLE "collection" ADD COLUMN "plan" jsonb;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "hosted_kind" text;--> statement-breakpoint
ALTER TABLE "report" ADD CONSTRAINT "report_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report" ADD CONSTRAINT "report_check_id_check_request_id_fk" FOREIGN KEY ("check_id") REFERENCES "public"."check_request"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report" ADD CONSTRAINT "report_collection_id_collection_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."collection"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_file" ADD CONSTRAINT "report_file_report_id_report_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."report"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "check_request" ADD CONSTRAINT "check_request_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "check_request" ADD CONSTRAINT "check_request_collection_id_collection_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."collection"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "funnel_event_name_idx" ON "funnel_event" USING btree ("name","created_at");--> statement-breakpoint
CREATE INDEX "report_ws_idx" ON "report" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "report_user_idx" ON "report" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "report_status_idx" ON "report" USING btree ("status");--> statement-breakpoint
CREATE INDEX "check_request_domain_idx" ON "check_request" USING btree ("domain","created_at");--> statement-breakpoint
CREATE INDEX "check_request_ip_idx" ON "check_request" USING btree ("ip_hash","created_at");--> statement-breakpoint
CREATE INDEX "check_request_status_idx" ON "check_request" USING btree ("status");