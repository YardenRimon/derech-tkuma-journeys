import { sql } from "drizzle-orm";
import { integer, primaryKey, sqliteTable, text, foreignKey, check } from "drizzle-orm/sqlite-core";

export const cmsPages = sqliteTable("cms_pages", {
  slug: text("slug").primaryKey(),
  draftJson: text("draft_json").notNull(),
  revision: integer("revision").notNull().default(0),
  publishedHtml: text("published_html"),
  publishedVersion: integer("published_version").notNull().default(0),
  updatedBy: text("updated_by").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const cmsVersions = sqliteTable("cms_versions", {
  slug: text("slug").notNull(),
  version: integer("version").notNull(),
  html: text("html").notNull(),
  draftJson: text("draft_json").notNull(),
  publishedBy: text("published_by").notNull(),
  publishedAt: text("published_at").notNull(),
}, (table) => [primaryKey({ columns: [table.slug, table.version] })]);

export const cmsSettings = sqliteTable("cms_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export const cmsUsers = sqliteTable("cms_users", {
  email: text("email").primaryKey(),
  authUserId: text("auth_user_id").unique(),
  cfAccessUserId: text("cf_access_user_id").unique(),
  role: text("role", { enum: ["system_admin", "content_editor"] }).notNull(),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  canPublish: integer("can_publish", { mode: "boolean" }).notNull().default(false),
  revision: integer("revision").notNull().default(1),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  lastLoginAt: text("last_login_at"),
});

export const cmsPermissionAudit = sqliteTable("cms_permission_audit", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  actorEmail: text("actor_email").notNull(),
  subjectEmail: text("subject_email").notNull(),
  operation: text("operation", { enum: ["create", "update", "bootstrap"] }).notNull(),
  oldRole: text("old_role"),
  newRole: text("new_role"),
  oldActive: integer("old_active", { mode: "boolean" }),
  newActive: integer("new_active", { mode: "boolean" }),
  oldCanPublish: integer("old_can_publish", { mode: "boolean" }),
  newCanPublish: integer("new_can_publish", { mode: "boolean" }),
  changedAt: text("changed_at").notNull(),
});

export const cmsRecords = sqliteTable("cms_records", {
 tenantId: text("tenant_id").notNull(), siteId: text("site_id").notNull(),
 kind: text("kind", { enum: ["tour", "occurrence"] }).notNull(), id: text("id").notNull(),
 recordJson: text("record_json").notNull(), publishedJson: text("published_json"),
 publishedVersion: integer("published_version").notNull().default(0),
 revision: integer("revision").notNull(), updatedAt: text("updated_at").notNull(), operationToken: text("operation_token").notNull(),
}, table => [primaryKey({columns:[table.tenantId,table.siteId,table.kind,table.id]}), check("cms_records_kind",sql`${table.kind} IN ('tour','occurrence')`)]);
export const cmsRecordHistory = sqliteTable("cms_record_history", {
 tenantId: text("tenant_id").notNull(), siteId: text("site_id").notNull(), kind: text("kind").notNull(), id: text("id").notNull(),
 version: integer("version").notNull(), snapshotJson: text("snapshot_json").notNull(),
}, table => [primaryKey({columns:[table.tenantId,table.siteId,table.kind,table.id,table.version]}),
 foreignKey({columns:[table.tenantId,table.siteId,table.kind,table.id],foreignColumns:[cmsRecords.tenantId,cmsRecords.siteId,cmsRecords.kind,cmsRecords.id]})]);
export const cmsDeploymentScope = sqliteTable("cms_deployment_scope", {
 singleton: integer("singleton").primaryKey(), tenantId: text("tenant_id").notNull(), siteId: text("site_id").notNull(),
}, table => [check("cms_deployment_scope_singleton",sql`${table.singleton}=1`)]);

// Projection of authoritative platform work_items + durable unsynchronized commands.
export const cmsTaskMirrors = sqliteTable("cms_task_mirrors", {
 tenantId: text("tenant_id").notNull(), siteId: text("site_id").notNull(), externalId: text("external_id").notNull(),
 recordJson: text("record_json").notNull(), assigneeEmail: text("assignee_email").notNull(), revision: integer("revision").notNull(),
 syncedAt: text("synced_at").notNull(), operationToken: text("operation_token").notNull(),
}, table=>[primaryKey({columns:[table.tenantId,table.siteId,table.externalId]})]);
export const cmsTaskCommands = sqliteTable("cms_task_commands", {
 tenantId: text("tenant_id").notNull(), siteId: text("site_id").notNull(), externalId: text("external_id").notNull(),
 commandKey: text("command_key").notNull(), commandJson: text("command_json").notNull(),
 state: text("state",{enum:["pending","accepted","rejected"]}).notNull(), resultNote: text("result_note").notNull(), createdAt: text("created_at").notNull(),
}, table=>[primaryKey({columns:[table.tenantId,table.siteId,table.commandKey]}),
 foreignKey({columns:[table.tenantId,table.siteId,table.externalId],foreignColumns:[cmsTaskMirrors.tenantId,cmsTaskMirrors.siteId,cmsTaskMirrors.externalId]}),
 check("cms_task_commands_state",sql`${table.state} IN ('pending','accepted','rejected')`)]);
export const cmsTaskAudit = sqliteTable("cms_task_audit", {
 tenantId: text("tenant_id").notNull(), siteId: text("site_id").notNull(), externalId: text("external_id").notNull(),
 revision: integer("revision").notNull(), auditJson: text("audit_json").notNull(),
}, table=>[primaryKey({columns:[table.tenantId,table.siteId,table.externalId,table.revision]}),
 foreignKey({columns:[table.tenantId,table.siteId,table.externalId],foreignColumns:[cmsTaskMirrors.tenantId,cmsTaskMirrors.siteId,cmsTaskMirrors.externalId]})]);
