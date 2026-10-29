ALTER TABLE `cms_users` ADD `cf_access_user_id` text;--> statement-breakpoint
CREATE UNIQUE INDEX `cms_users_cf_access_user_id_unique` ON `cms_users` (`cf_access_user_id`);