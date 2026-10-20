CREATE TABLE `cms_task_audit` (
	`tenant_id` text NOT NULL,
	`site_id` text NOT NULL,
	`external_id` text NOT NULL,
	`revision` integer NOT NULL,
	`audit_json` text NOT NULL,
	PRIMARY KEY(`tenant_id`, `site_id`, `external_id`, `revision`),
	FOREIGN KEY (`tenant_id`,`site_id`,`external_id`) REFERENCES `cms_task_mirrors`(`tenant_id`,`site_id`,`external_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `cms_task_commands` (
	`tenant_id` text NOT NULL,
	`site_id` text NOT NULL,
	`external_id` text NOT NULL,
	`command_key` text NOT NULL,
	`command_json` text NOT NULL,
	`state` text NOT NULL,
	`result_note` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`tenant_id`, `site_id`, `command_key`),
	FOREIGN KEY (`tenant_id`,`site_id`,`external_id`) REFERENCES `cms_task_mirrors`(`tenant_id`,`site_id`,`external_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "cms_task_commands_state" CHECK("cms_task_commands"."state" IN ('pending','accepted','rejected'))
);
--> statement-breakpoint
CREATE TABLE `cms_task_mirrors` (
	`tenant_id` text NOT NULL,
	`site_id` text NOT NULL,
	`external_id` text NOT NULL,
	`record_json` text NOT NULL,
	`assignee_email` text NOT NULL,
	`revision` integer NOT NULL,
	`synced_at` text NOT NULL,
	`operation_token` text NOT NULL,
	PRIMARY KEY(`tenant_id`, `site_id`, `external_id`)
);
