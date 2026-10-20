CREATE TABLE `cms_pages` (
	`slug` text PRIMARY KEY NOT NULL,
	`draft_json` text NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`published_html` text,
	`published_version` integer DEFAULT 0 NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `cms_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `cms_versions` (
	`slug` text NOT NULL,
	`version` integer NOT NULL,
	`html` text NOT NULL,
	`draft_json` text NOT NULL,
	`published_by` text NOT NULL,
	`published_at` text NOT NULL,
	PRIMARY KEY(`slug`, `version`)
);
