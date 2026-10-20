CREATE TABLE `platform_auth_rate_limits` (
	`bucket_key` text PRIMARY KEY NOT NULL,
	`window_start` integer NOT NULL,
	`attempts` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `platform_auth_rate_limits_expiry` ON `platform_auth_rate_limits` (`expires_at`);--> statement-breakpoint
ALTER TABLE `cms_users` ADD `platform_auth_user_id` text;--> statement-breakpoint
CREATE UNIQUE INDEX `cms_users_platform_auth_user_id_unique` ON `cms_users` (`platform_auth_user_id`);