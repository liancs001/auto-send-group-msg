/**
 * 任务调度模块
 * 支持：
 *   - 一次性任务（指定时间执行）
 *   - 定时循环任务（Cron 表达式）
 *   - 任务暂停/恢复/取消
 *   - 多模板关联：按模板为单位轮询发送到所有群组
 *   - 发送间隔控制（随机区间）
 *   - 发送日志记录
 */
const cron = require('node-cron');
const path = require('path');

const db = require('./database');
const wechat = require('./wechat-automation');

// 活跃任务 Map: taskId -> { cronJob, status, ... }
const activeTasks = new Map();

// 通知回调
let notifyCallback = null;

/**
 * 设置事件通知回调（推送给渲染进程）
 */
function setNotifyCallback(cb) {
  notifyCallback = cb;
}

function notify(event, data) {
  if (notifyCallback) {
    notifyCallback(event, data);
  }
}

/**
 * 初始化调度器：恢复所有 running/scheduled 状态的任务
 */
function init() {
  console.log('[Scheduler] 调度器初始化...');
  try {
    const tasks = db.getTasks();
    for (const task of tasks) {
      if (task.status === 'running' || task.status === 'scheduled') {
        // 恢复定时任务
        if (task.schedule_type === 'cron' && task.schedule_cron) {
          scheduleTask(task);
        } else if (task.schedule_type === 'once' && task.schedule_once_at) {
          const runAt = new Date(task.schedule_once_at);
          if (runAt > new Date()) {
            scheduleOnceTask(task);
          } else {
            // 过期的一次性任务标为完成
            db.updateTaskStatus(task.id, 'completed');
          }
        }
      }
    }

    // 心跳，每分钟检查一次
    cron.schedule('* * * * *', () => {
      checkPendingTasks();
      notify('scheduler-tick', { time: new Date().toISOString() });
    });

    console.log('[Scheduler] 初始化完成');
  } catch (err) {
    console.error('[Scheduler] 初始化失败:', err);
  }
}

/**
 * 检查待执行的一次性任务
 */
function checkPendingTasks() {
  const tasks = db.getTasks();
  const now = new Date();

  for (const task of tasks) {
    if (task.status === 'pending' && task.schedule_type === 'once' && task.schedule_once_at) {
      const runAt = new Date(task.schedule_once_at);
      if (runAt <= now && !activeTasks.has(task.id)) {
        console.log(`[Scheduler] 触发一次性任务: ${task.name}`);
        executeTask(task);
      }
    }
  }
}

/**
 * 手动启动任务
 */
async function startTask(taskId) {
  try {
    const tasks = db.getTasks();
    const task = tasks.find(t => t.id === taskId);
    if (!task) return { success: false, error: '任务不存在' };

    if (activeTasks.has(taskId)) {
      return { success: false, error: '任务已在运行中' };
    }

    if (task.schedule_type === 'cron' && task.schedule_cron) {
      scheduleTask(task);
    } else {
      // 立即执行
      executeTask(task);
    }

    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * 停止任务
 */
async function stopTask(taskId) {
  try {
    const active = activeTasks.get(taskId);
    if (active) {
      if (active.cronJob) {
        active.cronJob.stop();
      }
      active.cancelled = true;
      activeTasks.delete(taskId);
    }
    db.updateTaskStatus(taskId, 'stopped');
    notify('task-progress', { taskId, status: 'stopped' });
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * 暂停任务
 */
async function pauseTask(taskId) {
  try {
    const active = activeTasks.get(taskId);
    if (active && active.cronJob) {
      active.cronJob.stop();
      active.paused = true;
    }
    db.updateTaskStatus(taskId, 'paused');
    notify('task-progress', { taskId, status: 'paused' });
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * 调度 Cron 任务
 */
function scheduleTask(task) {
  if (!cron.validate(task.schedule_cron)) {
    console.error(`[Scheduler] 无效的 Cron 表达式: ${task.schedule_cron}`);
    return;
  }

  const job = cron.schedule(task.schedule_cron, () => {
    executeTask(task);
  }, { timezone: 'Asia/Shanghai' });

  activeTasks.set(task.id, { cronJob: job, status: 'scheduled', cancelled: false });
  db.updateTaskStatus(task.id, 'scheduled');
  console.log(`[Scheduler] 任务已调度: ${task.name} - ${task.schedule_cron}`);
}

/**
 * 调度一次性任务
 */
function scheduleOnceTask(task) {
  const runAt = new Date(task.schedule_once_at);
  const delay = runAt.getTime() - Date.now();

  if (delay <= 0) {
    executeTask(task);
    return;
  }

  const timer = setTimeout(() => {
    executeTask(task);
  }, delay);

  activeTasks.set(task.id, { timer, status: 'scheduled', cancelled: false });
  db.updateTaskStatus(task.id, 'scheduled');
  console.log(`[Scheduler] 一次性任务已调度: ${task.name} 将于 ${runAt.toLocaleString()} 执行`);
}

/**
 * 核心执行函数：按模板为单位轮询，每个模板依次发送到所有目标群组
 *
 * 执行顺序（方案 B）：
 *   模板T1 → 群G1, 群G2, ... 群GM  （群间等 interval_min~max 秒）
 *   模板T2 → 群G1, 群G2, ... 群GM  （模板间等 interval_min~max × 2 秒）
 */
async function executeTask(task) {
  const taskCtx = activeTasks.get(task.id) || {};
  taskCtx.status = 'running';
  taskCtx.cancelled = false;
  activeTasks.set(task.id, taskCtx);

  db.updateTaskStatus(task.id, 'running', { last_run_at: new Date().toISOString() });
  notify('task-progress', { taskId: task.id, status: 'running', message: `任务「${task.name}」开始执行` });

  console.log(`[Scheduler] 开始执行任务: ${task.name}`);

  try {
    // ── 收集目标群组 ──
    const targetGroups = await collectTargetGroups(task);
    if (targetGroups.length === 0) {
      throw new Error('没有找到目标群组');
    }

    // ── 收集关联的模板列表 ──
    const allTemplates = db.getTemplates();
    let templates = [];

    // 优先使用新的多模板字段 template_ids
    if (task.template_ids && Array.isArray(task.template_ids) && task.template_ids.length > 0) {
      templates = task.template_ids
        .map(tplId => allTemplates.find(t => t.id === tplId))
        .filter(Boolean);
    }

    // 兼容旧数据：template_ids 为空时，尝试旧字段降级
    if (templates.length === 0) {
      if (task.template_id) {
        const legacyTpl = allTemplates.find(t => t.id === task.template_id);
        if (legacyTpl) templates = [legacyTpl];
      }
      // 再降级：纯手工消息（无模板，直接用 message_content）
      if (templates.length === 0 && task.message_content) {
        templates = [{
          id: '__legacy__',
          name: '(未命名消息)',
          content: task.message_content,
          images: Array.isArray(task.message_images) ? task.message_images : []
        }];
      }
    }

    if (templates.length === 0) {
      throw new Error('没有找到可发送的消息内容，请关联至少一个消息模板');
    }

    const totalSends = templates.length * targetGroups.length;
    let sentCount = 0;
    let failedCount = 0;
    let globalIndex = 0;

    console.log(`[Scheduler] 任务「${task.name}」: ${templates.length} 个模板 × ${targetGroups.length} 个群 = ${totalSends} 条发送`);

    // ════════════════════════════════
    //  外层循环：遍历每个模板
    // ════════════════════════════════
    for (let ti = 0; ti < templates.length; ti++) {
      const tpl = templates[ti];

      const ctxOuter = activeTasks.get(task.id);
      if (!ctxOuter || ctxOuter.cancelled) {
        console.log(`[Scheduler] 任务已取消: ${task.name}`);
        break;
      }

      notify('task-progress', {
        taskId: task.id,
        status: 'running',
        templateIndex: ti + 1,
        templateTotal: templates.length,
        templateName: tpl.name,
        message: `开始发送「${tpl.name}」(${ti + 1}/${templates.length} 个模板)`
      });

      // ════════════════════════════════
      //  内层循环：遍历每个群组
      // ════════════════════════════════
      for (let gi = 0; gi < targetGroups.length; gi++) {
        const group = targetGroups[gi];
        globalIndex++;

        const ctxInner = activeTasks.get(task.id);
        if (!ctxInner || ctxInner.cancelled) {
          console.log(`[Scheduler] 任务已取消: ${task.name}`);
          break;
        }

        notify('task-progress', {
          taskId: task.id,
          status: 'running',
          current: globalIndex,
          total: totalSends,
          templateName: tpl.name,
          templateIndex: ti + 1,
          templateTotal: templates.length,
          groupName: group.name,
          message: `「${tpl.name}」→ ${group.name} (${gi + 1}/${targetGroups.length} 群, 第${ti + 1}/${templates.length}模板)`
        });

        try {
          const images = Array.isArray(tpl.images) ? tpl.images : [];

          const sendResult = await wechat.sendToGroup({
            groupKeywords: Array.isArray(group.keywords) && group.keywords.length
              ? group.keywords
              : [group.keyword || group.name],
            content: tpl.content || '',
            images,
            delay: 500,
            intervalMin: task.interval_min || 5,
            intervalMax: task.interval_max || 15
          });

          if (sendResult.success) {
            sentCount++;

            // 记录文本发送日志（带模板名前缀）
            if (tpl.content) {
              db.saveSendLog({
                task_id: task.id,
                group_name: group.name,
                group_keyword: (group.keywords || [group.keyword || group.name]).join(', '),
                message_content: `[${tpl.name}] ${tpl.content}`,
                has_image: images.length > 0 ? 1 : 0,
                status: sendResult.partial ? 'partial' : 'success',
                duration: sendResult.duration
              });
            }

            // 图片日志（每张一条）
            for (const imgPath of images) {
              db.saveSendLog({
                task_id: task.id,
                group_name: group.name,
                group_keyword: (group.keywords || [group.keyword || group.name]).join(', '),
                message_content: `[${tpl.name}] [图片] ${require('path').basename(imgPath)}`,
                has_image: 1,
                status: sendResult.partial ? 'partial' : 'success',
                duration: 0
              });
            }

            // 更新群组和模板统计
            db.updateGroup({ ...group, last_sent_at: new Date().toISOString(), send_count: (group.send_count || 0) + 1 });
            if (tpl.id !== '__legacy__') {
              db.prepare('UPDATE templates SET use_count = use_count + 1 WHERE id = ?').run(tpl.id);
            }
          } else {
            throw new Error(sendResult.error || '发送失败');
          }

          notify('message-sent', {
            taskId: task.id,
            groupName: group.name,
            templateName: tpl.name,
            success: true,
            sentCount,
            total: totalSends
          });

        } catch (sendErr) {
          failedCount++;
          console.error(`[Scheduler] 发送「${tpl.name}」到 ${group.name} 失败:`, sendErr);

          db.saveSendLog({
            task_id: task.id,
            group_name: group.name,
            group_keyword: group.keyword || group.name,
            message_content: `[${tpl.name}] ${tpl.content || ''}`,
            has_image: 0,
            status: 'failed',
            error_msg: sendErr.message
          });

          notify('task-error', {
            taskId: task.id,
            groupName: group.name,
            templateName: tpl.name,
            error: sendErr.message
          });
        }

        // ── 群间随机等待（防风控）──
        if (gi < targetGroups.length - 1) {
          const iMin = (task.interval_min || 5) * 1000;
          const iMax = (task.interval_max || 15) * 1000;
          const waitTime = Math.floor(Math.random() * (iMax - iMin)) + iMin;

          console.log(`[Scheduler] 等待 ${(waitTime / 1000).toFixed(1)}s 后发送下一个群...`);
          notify('task-progress', {
            taskId: task.id,
            status: 'waiting',
            waitSeconds: Math.ceil(waitTime / 1000),
            message: `等待 ${Math.ceil(waitTime / 1000)}s → 下一个群`
          });

          await sleep(waitTime);
        }
      } // end 内层循环：群组

      // ── 模板间等待（群间隔 × 2，更长冷却）──
      if (ti < templates.length - 1) {
        const tiMin = (task.interval_min || 5) * 2 * 1000;
        const tiMax = (task.interval_max || 15) * 2 * 1000;
        const tiWait = Math.floor(Math.random() * (tiMax - tiMin)) + tiMin;

        console.log(`[Scheduler] 模板间等待 ${(tiWait / 1000).toFixed(1)}s 后发送下一个模板...`);
        notify('task-progress', {
          taskId: task.id,
          status: 'waiting',
          waitSeconds: Math.ceil(tiWait / 1000),
          message: `「${tpl.name}」已完成，等待 ${Math.ceil(tiWait / 1000)}s → 下一个模板`
        });

        await sleep(tiWait);
      }
    } // end 外层循环：模板

    // 更新任务最终状态
    const finalStatus = task.schedule_type === 'cron' ? 'scheduled' : 'completed';
    db.updateTaskStatus(task.id, finalStatus, {
      total_sent: sentCount,
      total_failed: failedCount
    });

    if (task.schedule_type !== 'cron') {
      activeTasks.delete(task.id);
    }

    notify('task-complete', {
      taskId: task.id,
      taskName: task.name,
      sentCount,
      failedCount,
      total: totalSends
    });

    console.log(`[Scheduler] 任务完成: ${task.name} - 成功: ${sentCount}, 失败: ${failedCount}, 总计: ${totalSends}`);

  } catch (err) {
    console.error('[Scheduler] 任务执行出错:', err);
    db.updateTaskStatus(task.id, 'failed');
    activeTasks.delete(task.id);

    notify('task-error', {
      taskId: task.id,
      taskName: task.name,
      error: err.message,
      fatal: true
    });
  }
}

/**
 * 收集任务的目标群组
 */
async function collectTargetGroups(task) {
  const allGroups = db.getGroups();
  const targetSet = new Map();

  // 直接指定的群组
  for (const gid of (task.group_ids || [])) {
    const group = allGroups.find(g => g.id === gid && g.is_active);
    if (group) targetSet.set(gid, group);
  }

  // 分类下的所有群组
  for (const cid of (task.category_ids || [])) {
    const catGroups = allGroups.filter(g => g.category_id === cid && g.is_active);
    for (const g of catGroups) {
      targetSet.set(g.id, g);
    }
  }

  return Array.from(targetSet.values());
}

function getStatus() {
  const status = {};
  for (const [id, ctx] of activeTasks.entries()) {
    status[id] = { status: ctx.status, cancelled: ctx.cancelled, paused: ctx.paused };
  }
  return status;
}

function destroy() {
  for (const [id, ctx] of activeTasks.entries()) {
    if (ctx.cronJob) ctx.cronJob.stop();
    if (ctx.timer) clearTimeout(ctx.timer);
  }
  activeTasks.clear();
  console.log('[Scheduler] 调度器已销毁');
}

// 工具函数
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const randomIntervalSleep = (min, max) => {
  const delay = Math.floor(Math.random() * (max - min)) + min;
  return sleep(delay);
};

module.exports = {
  init, destroy, setNotifyCallback,
  startTask, stopTask, pauseTask,
  getStatus
};
