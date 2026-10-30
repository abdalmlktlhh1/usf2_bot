import { table, integer, text, boolean, json, uniqueIndex, index } from 'sdk/db';

// Anonymous visitor heartbeat for live website analytics.
export const visitorStats = table('site_visitor_stats', {
  visitorId: text('visitor_id').primaryKey(),
  firstSeen: integer('first_seen').notNull(),
  lastSeen: integer('last_seen').notNull(),
  visitCount: integer('visit_count').notNull().default(1),
  // Identity is collected only from a verified Telegram WebApp context or a validated student session.
  accountUsername: text('account_username'),
  displayName: text('display_name'),
  accountSessionActive: boolean('account_session_active').notNull().default(false),
  telegramId: integer('telegram_id'),
  telegramUsername: text('telegram_username'),
  telegramName: text('telegram_name'),
});

// Shared feed of one-time achievement announcements for users currently on the platform.
export const achievementEvents = table('achievement_events', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  telegramId: integer('telegram_id').notNull(),
  achievementKey: text('achievement_key').notNull(),
  icon: text('icon').notNull(),
  title: text('title').notNull(),
  message: text('message').notNull(),
  displayName: text('display_name').notNull().default('طالب'),
  username: text('username').notNull().default(''),
  createdAt: integer('created_at').notNull(),
}, (t) => ({
  oncePerUser: uniqueIndex('uq_achievement_events_user_key').on(t.telegramId, t.achievementKey),
  createdIndex: index('idx_achievement_events_created').on(t.createdAt),
}));

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


// Student-submitted question reports are separate records to avoid concurrent writes
// overwriting reports submitted by other users.
export const questionReports = table('question_reports', {
  id: text('id').primaryKey(),
  telegramId: integer('telegram_id').notNull(),
  username: text('username').notNull().default(''),
  displayName: text('display_name').notNull().default('طالب'),
  questionId: text('question_id').notNull(),
  questionText: text('question_text').notNull().default(''),
  courseId: integer('course_id').notNull().default(0),
  course: text('course').notNull().default(''),
  sourceYear: integer('source_year').notNull().default(0),
  sourceFile: text('source_file').notNull().default(''),
  reportType: text('report_type').notNull(),
  details: text('details').notNull().default(''),
  status: text('status').notNull().default('open'),
  priority: text('priority').notNull().default('normal'),
  assignedTo: integer('assigned_to'),
  assignedName: text('assigned_name').notNull().default(''),
  resolutionNote: text('resolution_note').notNull().default(''),
  resolutionCode: text('resolution_code').notNull().default(''),
  duplicateOf: text('duplicate_of'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at'),
  lastActionBy: integer('last_action_by'),
  resolvedAt: integer('resolved_at'),
  resolvedBy: integer('resolved_by'),
}, (t) => ({
  createdIndex: index('idx_question_reports_created').on(t.createdAt),
  questionIndex: index('idx_question_reports_question').on(t.questionId),
  statusIndex: index('idx_question_reports_status').on(t.status),
  assigneeIndex: index('idx_question_reports_assignee').on(t.assignedTo),
}));

// Question additions and edits from non-publishing editors remain unpublished until an authorized reviewer approves them.
export const questionApprovalRequests = table('question_approval_requests', {
  id: text('id').primaryKey(),
  requestType: text('request_type').notNull(),
  questionId: text('question_id').notNull().default(''),
  courseId: integer('course_id').notNull(),
  payload: json('payload').notNull(),
  beforeSnapshot: json('before_snapshot'),
  baseUpdatedAt: text('base_updated_at').notNull().default(''),
  status: text('status').notNull().default('pending'),
  submittedBy: integer('submitted_by').notNull(),
  submitterName: text('submitter_name').notNull().default(''),
  submittedAt: integer('submitted_at').notNull(),
  reviewerId: integer('reviewer_id'),
  reviewerName: text('reviewer_name').notNull().default(''),
  reviewedAt: integer('reviewed_at'),
  decisionNote: text('decision_note').notNull().default(''),
  appliedQuestionId: integer('applied_question_id'),
}, (t) => ({
  statusIndex: index('idx_question_approval_status').on(t.status, t.submittedAt),
  courseIndex: index('idx_question_approval_course').on(t.courseId, t.submittedAt),
  questionIndex: index('idx_question_approval_question').on(t.questionId, t.status),
}));
