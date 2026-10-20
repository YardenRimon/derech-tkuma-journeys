CREATE TABLE `cms_record_history` (
	`tenant_id` text NOT NULL,
	`site_id` text NOT NULL,
	`kind` text NOT NULL,
	`id` text NOT NULL,
	`version` integer NOT NULL,
	`snapshot_json` text NOT NULL,
	PRIMARY KEY(`tenant_id`, `site_id`, `kind`, `id`, `version`),
	FOREIGN KEY (`tenant_id`,`site_id`,`kind`,`id`) REFERENCES `cms_records`(`tenant_id`,`site_id`,`kind`,`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `cms_records` (
	`tenant_id` text NOT NULL,
	`site_id` text NOT NULL,
	`kind` text NOT NULL,
	`id` text NOT NULL,
	`record_json` text NOT NULL,
	`published_json` text,
	`published_version` integer DEFAULT 0 NOT NULL,
	`revision` integer NOT NULL,
	`updated_at` text NOT NULL,
	`operation_token` text NOT NULL,
	PRIMARY KEY(`tenant_id`, `site_id`, `kind`, `id`),
	CONSTRAINT "cms_records_kind" CHECK("cms_records"."kind" IN ('tour','occurrence'))
);
