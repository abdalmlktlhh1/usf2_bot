import { table, integer, text, boolean, json, uniqueIndex, index } from 'sdk/db';

// Anonymous visitor heartbeat for live website analytics.
export const visitorStats = table('site_visitor_stats', {
  visitorId: text('visitor_id').primaryKey(),
  firstSeen: integer('first_seen').notNull(),
  lastSeen: integer('last_seen').notNull(),
  visitCount: integer('visit_count').notNull().default(1),
});

// One active quiz session per Telegram user in each chat.
export const quizSessions = table('quiz_sessions', {
  sessionId: text('session_id').primaryKey(),
  userId: integer('user_id').notNull(),
  chatId: integer('chat_id').notNull(),
  sessionToken: text('session_token').notNull(),
  messageId: integer('message_id').notNull().default(0),
  questionIndex: integer('question_index').notNull().default(0),
  score: integer('score').notNull().default(0),
});

// Academic content hierarchy: level -> subject -> course -> question.
// Relationships are checked in application code because TGCloud's SQLite layer
// does not enforce foreign keys.
export const levels = table('academic_levels', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  sortOrder: integer('sort_order').notNull().default(0),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
}, (t) => ({
  nameUnique: uniqueIndex('uq_academic_levels_name').on(t.name),
}));

export const subjects = table('academic_subjects', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  levelId: integer('level_id').notNull(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  sortOrder: integer('sort_order').notNull().default(0),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
}, (t) => ({
  levelNameUnique: uniqueIndex('uq_academic_subjects_level_name').on(t.levelId, t.name),
  levelIndex: index('idx_academic_subjects_level').on(t.levelId),
}));

export const courses = table('academic_courses', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  subjectId: integer('subject_id').notNull(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  durationMinutes: integer('duration_minutes').notNull().default(60),
  passingScore: integer('passing_score').notNull().default(50),
  sortOrder: integer('sort_order').notNull().default(0),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
}, (t) => ({
  subjectNameUnique: uniqueIndex('uq_academic_courses_subject_name').on(t.subjectId, t.name),
  subjectIndex: index('idx_academic_courses_subject').on(t.subjectId),
}));

export const questions = table('academic_questions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  courseId: integer('course_id').notNull(),
  questionText: text('question_text').notNull(),
  options: json('options').notNull(),
  correctIndex: integer('correct_index').notNull(),
  explanation: text('explanation').notNull().default(''),
  difficulty: text('difficulty').notNull().default('normal'),
  sourceQuestionNumber: integer('source_question_number'),
  sortOrder: integer('sort_order').notNull().default(0),
  isActive: boolean('is_active').notNull().default(true),
  createdBy: integer('created_by').notNull(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
}, (t) => ({
  courseIndex: index('idx_academic_questions_course').on(t.courseId),
}));

// Moderator identity is their Telegram user ID. The owner ID is reserved in code
// and is never mutable through the moderator-management API.
export const moderators = table('admin_moderators', {
  telegramId: integer('telegram_id').primaryKey(),
  displayName: text('display_name').notNull().default('مشرف'),
  roleKey: text('role_key').notNull().default('custom'),
  permissions: json('permissions').notNull(),
  scopeCourseIds: json('scope_course_ids').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  createdBy: integer('created_by').notNull(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const auditLogs = table('admin_audit_logs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  actorId: integer('actor_id').notNull(),
  actorName: text('actor_name').notNull().default(''),
  action: text('action').notNull(),
  entityType: text('entity_type').notNull(),
  entityId: integer('entity_id').notNull().default(0),
  details: json('details').notNull(),
  createdAt: integer('created_at').notNull(),
}, (t) => ({
  createdIndex: index('idx_admin_audit_logs_created').on(t.createdAt),
  actorIndex: index('idx_admin_audit_logs_actor').on(t.actorId),
}));

// Dynamically managed Telegram bot buttons with nested inline menus.
export const botMenuItems = table('bot_menu_items', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  parentId: integer('parent_id'),
  text: text('text').notNull(),
  type: text('type').notNull(),
  value: text('value').notNull().default(''),
  description: text('description').notNull().default(''),
  sortOrder: integer('sort_order').notNull().default(0),
  isActive: boolean('is_active').notNull().default(true),
  adminOnly: boolean('admin_only').notNull().default(false),
  createdBy: integer('created_by').notNull(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
}, (t) => ({
  parentOrderIndex: index('idx_bot_menu_items_parent_order').on(t.parentId, t.sortOrder),
}));


// Singleton configuration shared by the public exam page and owner dashboard.
export const siteSettings = table('site_settings', {
  key: text('key').primaryKey(),
  value: json('value').notNull(),
  updatedAt: integer('updated_at').notNull(),
  updatedBy: integer('updated_by').notNull().default(0),
});
