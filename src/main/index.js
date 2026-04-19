const { app, BrowserWindow, ipcMain, shell, dialog, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');

// 确保单实例
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
}

let mainWindow = null;
let tray = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1100,
    minHeight: 700,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#0f0f1a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false
    },
    icon: path.join(__dirname, '../../assets/icon-64.png'),
    show: false
  });

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

  // 开发者工具快捷键（Ctrl+Shift+I 或 F12）
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if ((input.control && input.shift && input.key === 'i') ||
        (input.key === 'F12')) {
      event.preventDefault();
      if (mainWindow.webContents.isDevToolsOpened()) {
        mainWindow.webContents.closeDevTools();
      } else {
        mainWindow.webContents.openDevTools();
      }
    }
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    // 开发模式打开DevTools
    if (process.argv.includes('--dev')) {
      mainWindow.webContents.openDevTools();
    }
  });

  mainWindow.on('close', (e) => {
    e.preventDefault();
    mainWindow.hide();
  });

  // 注册所有 IPC 处理器
  registerIpcHandlers();
}

function createTray() {
  const iconPath = path.join(__dirname, '../../assets/tray-icon.png');
  let icon;
  if (fs.existsSync(iconPath)) {
    icon = nativeImage.createFromPath(iconPath);
    // Windows 托盘图标推荐 16x16（系统会自动缩放），显式 resize 避免模糊
    icon = icon.resize({ width: 32, height: 32 });
  } else {
    icon = nativeImage.createEmpty();
  }
  
  tray = new Tray(icon);
  const contextMenu = Menu.buildFromTemplate([
    { label: 'AI微信群发助手', enabled: false },
    { type: 'separator' },
    { label: '显示主窗口', click: () => { mainWindow.show(); mainWindow.focus(); } },
    { type: 'separator' },
    { label: '退出', click: () => { app.exit(0); } }
  ]);

  tray.setToolTip('AI微信群发助手');
  tray.setContextMenu(contextMenu);
  tray.on('double-click', () => {
    mainWindow.show();
    mainWindow.focus();
  });
}

function registerIpcHandlers() {
  // 窗口控制
  ipcMain.on('window-minimize', () => mainWindow.minimize());
  ipcMain.on('window-maximize', () => {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  });
  ipcMain.on('window-close', () => mainWindow.hide());

  // 数据库模块
  const dbModule = require('./modules/database');
  
  // 群组管理
  ipcMain.handle('get-groups', () => dbModule.getGroups());
  ipcMain.handle('save-group', (_, group) => dbModule.saveGroup(group));
  ipcMain.handle('delete-group', (_, id) => dbModule.deleteGroup(id));
  ipcMain.handle('update-group', (_, group) => dbModule.updateGroup(group));

  // 群组分类
  ipcMain.handle('get-categories', () => dbModule.getCategories());
  ipcMain.handle('save-category', (_, category) => dbModule.saveCategory(category));
  ipcMain.handle('delete-category', (_, id) => dbModule.deleteCategory(id));

  // 消息模板
  ipcMain.handle('get-templates', () => dbModule.getTemplates());
  ipcMain.handle('save-template', (_, template) => dbModule.saveTemplate(template));
  ipcMain.handle('delete-template', (_, id) => dbModule.deleteTemplate(id));

  // 发送任务
  ipcMain.handle('get-tasks', () => dbModule.getTasks());
  ipcMain.handle('save-task', (_, task) => dbModule.saveTask(task));
  ipcMain.handle('delete-task', (_, id) => dbModule.deleteTask(id));
  ipcMain.handle('update-task-status', (_, id, status) => dbModule.updateTaskStatus(id, status));

  // 发送日志
  ipcMain.handle('get-logs', (_, limit) => dbModule.getLogs(limit));
  ipcMain.handle('clear-logs', () => dbModule.clearLogs());

  // 统计数据
  ipcMain.handle('get-stats', () => dbModule.getStats());

  // 微信自动化
  const wechatModule = require('./modules/wechat-automation');

  ipcMain.handle('find-wechat', () => wechatModule.findWechatWindow());
  ipcMain.handle('activate-wechat', () => wechatModule.activateWechat());
  ipcMain.handle('search-group', (_, keyword) => wechatModule.searchGroup(keyword));
  ipcMain.handle('send-message', (_, params) => wechatModule.sendMessage(params));
  ipcMain.handle('send-image', (_, params) => wechatModule.sendImage(params));
  ipcMain.handle('take-screenshot', () => wechatModule.takeScreenshot());

  // 任务调度
  const schedulerModule = require('./modules/scheduler');
  
  ipcMain.handle('start-task', (_, taskId) => schedulerModule.startTask(taskId));
  ipcMain.handle('stop-task', (_, taskId) => schedulerModule.stopTask(taskId));
  ipcMain.handle('pause-task', (_, taskId) => schedulerModule.pauseTask(taskId));
  ipcMain.handle('get-scheduler-status', () => schedulerModule.getStatus());

  // 文件操作
  ipcMain.handle('select-image', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择图片',
      filters: [{ name: '图片文件', extensions: ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp'] }],
      properties: ['openFile', 'multiSelections']
    });
    return result.canceled ? [] : result.filePaths;
  });

  ipcMain.handle('open-external', (_, url) => shell.openExternal(url));

  // 推送通知给渲染进程
  schedulerModule.setNotifyCallback((event, data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(event, data);
    }
  });

  // 启动调度器
  schedulerModule.init();
}

app.whenReady().then(() => {
  createWindow();
  createTray();

  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
});

app.on('window-all-closed', () => {
  // Windows 下不退出，继续托盘运行
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on('before-quit', () => {
  const schedulerModule = require('./modules/scheduler');
  schedulerModule.destroy();
});
