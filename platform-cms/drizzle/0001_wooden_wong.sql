CREATE TABLE `cms_permission_audit` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`actor_email` text NOT NULL,
	`subject_email` text NOT NULL,
	`operation` text NOT NULL,
	`old_role` text,
	`new_role` text,
	`old_active` integer,
	`new_active` integer,
	`old_can_publish` integer,
	`new_can_publish` integer,
	`changed_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `cms_users` (
	`email` text PRIMARY KEY NOT NULL,
	`auth_user_id` text,
	`role` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`can_publish` integer DEFAULT false NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`last_login_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cms_users_auth_user_id_unique` ON `cms_users` (`auth_user_id`);