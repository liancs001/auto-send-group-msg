/**
 * 数据库模块 - 使用 better-sqlite3 进行数据持久化
 * 存储群组、模板、任务、日志等所有数据
 */
const path = require('path');
const fs = require('fs');
const { app } = require('electron');

let db = null;

function getDbPath() {
  const userDataPath = app.getPath('userData');
  return path.join(userDataPath, 'wechat-sender.db');
}

function initDatabase() {
  try {
    const Database = require('better-sqlite3');
    const dbPath = getDbPath();
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');

    // 创建表结构
    db.exec(`
      -- 群组分类表
      CREATE TABLE IF NOT EXISTS categories (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        color TEXT DEFAULT '#6366f1',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      -- 群组表
      CREATE TABLE IF NOT EXISTS groups_info (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        keyword TEXT NOT NULL,
        keywords TEXT DEFAULT '[]',
        category_id TEXT,
        avatar TEXT,
        last_sent_at DATETIME,
        send_count INTEGER DEFAULT 0,
        notes TEXT,
        is_active INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (category_id) REFERENCES categories(id)
      );

      -- 消息模板表
      CREATE TABLE IF NOT EXISTS templates (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        content TEXT NOT NULL,
        images TEXT DEFAULT '[]',
        variables TEXT DEFAULT '[]',
        category TEXT,
        use_count INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      -- 发送任务表
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        group_ids TEXT NOT NULL DEFAULT '[]',
        category_ids TEXT DEFAULT '[]',
        template_id TEXT,
        message_content TEXT,
        message_images TEXT DEFAULT '[]',
        interval_min INTEGER DEFAULT 5,
        interval_max INTEGER DEFAULT 15,
        schedule_type TEXT DEFAULT 'once',
        schedule_cron TEXT,
        schedule_once_at DATETIME,
        status TEXT DEFAULT 'pending',
        priority INTEGER DEFAULT 5,
        max_retries INTEGER DEFAULT 2,
        retry_delay INTEGER DEFAULT 60,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_run_at DATETIME,
        next_run_at DATETIME,
        total_sent INTEGER DEFAULT 0,
        total_failed INTEGER DEFAULT 0
      );

      -- 发送日志表
      CREATE TABLE IF NOT EXISTS send_logs (
        id TEXT PRIMARY KEY,
        task_id TEXT,
        group_name TEXT NOT NULL,
        group_keyword TEXT,
        message_content TEXT,
        has_image INTEGER DEFAULT 0,
        status TEXT NOT NULL,
        error_msg TEXT,
        sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        duration INTEGER DEFAULT 0
      );

      -- 应用配置表
      CREATE TABLE IF NOT EXISTS app_config (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 插入默认配置
    const defaultConfigs = [
      ['min_interval', '5'],
      ['max_interval', '15'],
      ['wechat_path', ''],
      ['auto_start', '0'],
      ['send_sound', '1'],
      ['theme', 'dark']
    ];

    const insertConfig = db.prepare(
      'INSERT OR IGNORE INTO app_config (key, value) VALUES (?, ?)'
    );
    for (const [key, value] of defaultConfigs) {
      insertConfig.run(key, value);
    }

    // ── 迁移：为旧表补 keywords 列，并将旧 keyword 字符串转成 JSON 数组 ──
    const colExists = db.prepare(
      "SELECT COUNT(*) as n FROM pragma_table_info('groups_info') WHERE name='keywords'"
    ).get().n;
    if (!colExists) {
      db.exec("ALTER TABLE groups_info ADD COLUMN keywords TEXT DEFAULT '[]'");
    }
    // 将 keywords 仍为 '[]' 或 NULL 的行，用旧 keyword 字段填充
    db.prepare(`
      UPDATE groups_info
      SET keywords = json_array(keyword)
      WHERE keywords IS NULL OR keywords = '[]' OR keywords = ''
    `).run();

    // ── 迁移：为 tasks 表补 template_ids 列（多模板关联）──
    const tplIdsCol = db.prepare(
      "SELECT COUNT(*) as n FROM pragma_table_info('tasks') WHERE name='template_ids'"
    ).get().n;
    if (!tplIdsCol) {
      db.exec("ALTER TABLE tasks ADD COLUMN template_ids TEXT DEFAULT '[]'");
      console.log('[Database] 新增 tasks.template_ids 列');
    }

    console.log('[Database] 初始化成功:', getDbPath());
    return true;
  } catch (err) {
    console.error('[Database] 初始化失败:', err);
    return false;
  }
}

// 群组分类 CRUD
function getCategories() {
  ensureDb();
  return db.prepare('SELECT * FROM categories ORDER BY created_at ASC').all();
}

function saveCategory(category) {
  ensureDb();
  const { v4: uuidv4 } = require('uuid');
  const id = category.id || uuidv4();
  const now = new Date().toISOString();
  
  if (category.id) {
    db.prepare(`
      UPDATE categories SET name=?, description=?, color=?, updated_at=?
      WHERE id=?
    `).run(category.name, category.description || '', category.color || '#6366f1', now, category.id);
  } else {
    db.prepare(`
      INSERT INTO categories (id, name, description, color, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, category.name, category.description || '', category.color || '#6366f1', now, now);
  }
  return { ...category, id };
}

function deleteCategory(id) {
  ensureDb();
  // 先将该分类下的群组解除绑定
  db.prepare('UPDATE groups_info SET category_id=NULL WHERE category_id=?').run(id);
  return db.prepare('DELETE FROM categories WHERE id=?').run(id);
}

// 群组 CRUD
function getGroups() {
  ensureDb();
  return db.prepare(`
    SELECT g.*, c.name as category_name, c.color as category_color
    FROM groups_info g
    LEFT JOIN categories c ON g.category_id = c.id
    ORDER BY g.created_at ASC
  `).all().map(g => ({
    ...g,
    // keywords 优先取 JSON 数组，若为空则降级用旧 keyword 字段
    keywords: (() => {
      try {
        const arr = JSON.parse(g.keywords || '[]');
        return Array.isArray(arr) && arr.length ? arr : (g.keyword ? [g.keyword] : []);
      } catch { return g.keyword ? [g.keyword] : []; }
    })()
  }));
}

function saveGroup(group) {
  ensureDb();
  const { v4: uuidv4 } = require('uuid');
  const id = group.id || uuidv4();
  const now = new Date().toISOString();

  // 统一处理 keywords 字段
  // 支持传入 keywords 数组，或旧式单 keyword 字符串
  let kwArr = [];
  if (Array.isArray(group.keywords) && group.keywords.length) {
    kwArr = group.keywords.map(k => k.trim()).filter(Boolean);
  } else if (group.keyword) {
    kwArr = [group.keyword.trim()].filter(Boolean);
  }
  if (!kwArr.length) kwArr = [''];
  const keywordsJson = JSON.stringify(kwArr);
  const keyword = kwArr[0]; // 保持旧字段兼容

  if (group.id) {
    db.prepare(`
      UPDATE groups_info SET name=?, keyword=?, keywords=?, category_id=?, notes=?, is_active=?, updated_at=?
      WHERE id=?
    `).run(group.name, keyword, keywordsJson, group.category_id || null, group.notes || '', group.is_active ?? 1, now, group.id);
  } else {
    db.prepare(`
      INSERT INTO groups_info (id, name, keyword, keywords, category_id, notes, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, group.name, keyword, keywordsJson, group.category_id || null, group.notes || '', group.is_active ?? 1, now, now);
  }
  return { ...group, id, keywords: kwArr, keyword };
}

function updateGroup(group) {
  return saveGroup(group);
}

function deleteGroup(id) {
  ensureDb();
  return db.prepare('DELETE FROM groups_info WHERE id=?').run(id);
}

// 消息模板 CRUD
function getTemplates() {
  ensureDb();
  return db.prepare('SELECT * FROM templates ORDER BY use_count DESC, created_at DESC').all().map(t => ({
    ...t,
    images: JSON.parse(t.images || '[]'),
    variables: JSON.parse(t.variables || '[]')
  }));
}

function saveTemplate(template) {
  ensureDb();
  const { v4: uuidv4 } = require('uuid');
  const id = template.id || uuidv4();
  const now = new Date().toISOString();
  const images = JSON.stringify(template.images || []);
  const variables = JSON.stringify(template.variables || []);

  if (template.id) {
    db.prepare(`
      UPDATE templates SET name=?, content=?, images=?, variables=?, category=?, updated_at=?
      WHERE id=?
    `).run(template.name, template.content, images, variables, template.category || '', now, template.id);
  } else {
    db.prepare(`
      INSERT INTO templates (id, name, content, images, variables, category, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, template.name, template.content, images, variables, template.category || '', now, now);
  }
  return { ...template, id };
}

function deleteTemplate(id) {
  ensureDb();
  return db.prepare('DELETE FROM templates WHERE id=?').run(id);
}

// 任务 CRUD
function getTasks() {
  ensureDb();
  return db.prepare('SELECT * FROM tasks ORDER BY created_at DESC').all().map(t => ({
    ...t,
    group_ids: JSON.parse(t.group_ids || '[]'),
    category_ids: JSON.parse(t.category_ids || '[]'),
    message_images: JSON.parse(t.message_images || '[]'),
    template_ids: JSON.parse(t.template_ids || '[]')
  }));
}

function saveTask(task) {
  ensureDb();
  const { v4: uuidv4 } = require('uuid');
  const id = task.id || uuidv4();
  const now = new Date().toISOString();
  const groupIds = JSON.stringify(task.group_ids || []);
  const categoryIds = JSON.stringify(task.category_ids || []);
  const images = JSON.stringify(task.message_images || []);
  const templateIds = JSON.stringify(task.template_ids || []);

  if (task.id) {
    db.prepare(`
      UPDATE tasks SET name=?, group_ids=?, category_ids=?, template_ids=?, template_id=?,
        message_content=?, message_images=?, interval_min=?, interval_max=?,
        schedule_type=?, schedule_cron=?, schedule_once_at=?, priority=?,
        max_retries=?, retry_delay=?, updated_at=?
      WHERE id=?
    `).run(
      task.name, groupIds, categoryIds, templateIds, task.template_id || null,
      task.message_content || '', images, task.interval_min || 5, task.interval_max || 15,
      task.schedule_type || 'once', task.schedule_cron || null, task.schedule_once_at || null,
      task.priority || 5, task.max_retries || 2, task.retry_delay || 60, now,
      task.id
    );
  } else {
    db.prepare(`
      INSERT INTO tasks (id, name, group_ids, category_ids, template_ids, template_id,
        message_content, message_images, interval_min, interval_max,
        schedule_type, schedule_cron, schedule_once_at, status, priority,
        max_retries, retry_delay, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)
    `).run(
      id, task.name, groupIds, categoryIds, templateIds, task.template_id || null,
      task.message_content || '', images, task.interval_min || 5, task.interval_max || 15,
      task.schedule_type || 'once', task.schedule_cron || null, task.schedule_once_at || null,
      task.priority || 5, task.max_retries || 2, task.retry_delay || 60, now, now
    );
  }
  return { ...task, id };
}

function deleteTask(id) {
  ensureDb();
  return db.prepare('DELETE FROM tasks WHERE id=?').run(id);
}

function updateTaskStatus(id, status, extra = {}) {
  ensureDb();
  const now = new Date().toISOString();
  const updates = ['status=?', 'updated_at=?'];
  const values = [status, now];

  if (extra.last_run_at) { updates.push('last_run_at=?'); values.push(extra.last_run_at); }
  if (extra.next_run_at) { updates.push('next_run_at=?'); values.push(extra.next_run_at); }
  if (extra.total_sent !== undefined) { updates.push('total_sent=total_sent+?'); values.push(extra.total_sent); }
  if (extra.total_failed !== undefined) { updates.push('total_failed=total_failed+?'); values.push(extra.total_failed); }

  values.push(id);
  db.prepare(`UPDATE tasks SET ${updates.join(', ')} WHERE id=?`).run(...values);
}

// 日志
function saveSendLog(log) {
  ensureDb();
  const { v4: uuidv4 } = require('uuid');
  const id = log.id || uuidv4();
  db.prepare(`
    INSERT INTO send_logs (id, task_id, group_name, group_keyword, message_content, has_image, status, error_msg, sent_at, duration)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, log.task_id || null, log.group_name, log.group_keyword || '',
    log.message_content || '', log.has_image ? 1 : 0,
    log.status, log.error_msg || null,
    log.sent_at || new Date().toISOString(), log.duration || 0
  );
  return id;
}

function getLogs(limit = 200) {
  ensureDb();
  return db.prepare(`
    SELECT l.*, t.name as task_name
    FROM send_logs l
    LEFT JOIN tasks t ON l.task_id = t.id
    ORDER BY l.sent_at DESC
    LIMIT ?
  `).all(limit);
}

function clearLogs() {
  ensureDb();
  return db.prepare('DELETE FROM send_logs').run();
}

// 统计
function getStats() {
  ensureDb();
  const totalGroups = db.prepare('SELECT COUNT(*) as cnt FROM groups_info WHERE is_active=1').get().cnt;
  const weekGroups = db.prepare(`
    SELECT COUNT(*) as cnt FROM groups_info 
    WHERE created_at >= date('now', '-7 days', 'start of day')
  `).get().cnt;
  const totalTasks = db.prepare('SELECT COUNT(*) as cnt FROM tasks').get().cnt;
  const runningTasks = db.prepare("SELECT COUNT(*) as cnt FROM tasks WHERE status='running'").get().cnt;
  const todaySent = db.prepare(`
    SELECT COUNT(*) as cnt FROM send_logs 
    WHERE status='success' AND sent_at >= date('now', 'start of day')
  `).get().cnt;
  const totalSent = db.prepare("SELECT COUNT(*) as cnt FROM send_logs WHERE status='success'").get().cnt;
  const failedToday = db.prepare(`
    SELECT COUNT(*) as cnt FROM send_logs 
    WHERE status='failed' AND sent_at >= date('now', 'start of day')
  `).get().cnt;

  return { totalGroups, weekGroups, totalTasks, runningTasks, todaySent, totalSent, failedToday };
}

// 配置
function getConfig(key) {
  ensureDb();
  const row = db.prepare('SELECT value FROM app_config WHERE key=?').get(key);
  return row ? row.value : null;
}

function setConfig(key, value) {
  ensureDb();
  db.prepare('INSERT OR REPLACE INTO app_config (key, value, updated_at) VALUES (?, ?, ?)').run(key, value, new Date().toISOString());
}

function ensureDb() {
  if (!db) initDatabase();
}

// 初始化
initDatabase();

module.exports = {
  initDatabase, getDbPath,
  getCategories, saveCategory, deleteCategory,
  getGroups, saveGroup, updateGroup, deleteGroup,
  getTemplates, saveTemplate, deleteTemplate,
  getTasks, saveTask, deleteTask, updateTaskStatus,
  saveSendLog, getLogs, clearLogs,
  getStats, getConfig, setConfig
};
