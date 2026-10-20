CREATE TABLE `cms_deployment_scope` (
	`singleton` integer PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`site_id` text NOT NULL,
	CONSTRAINT "cms_deployment_scope_singleton" CHECK("cms_deployment_scope"."singleton"=1)
);
