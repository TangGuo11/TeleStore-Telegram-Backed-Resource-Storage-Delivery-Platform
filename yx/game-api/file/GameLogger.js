// game-api/file/GameLogger.js-日志系统
const fs = require('fs');
const path = require('path');

// 🎯 创建日志目录
const logDir = path.join(process.env.GAME_STORAGE_DIR || path.join(process.cwd(), 'downloads', 'yx'), 'logs');
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

// 🎯 工具函数
function getTimestamp() {
  return new Date().toISOString().replace('T', ' ').substring(0, 19);
}

// 🎯 直接导出对象，确保不会出现 this 问题
const GameLogger = {
  file(msg, data = null) {
    const logMsg = `[${getTimestamp()}] [GAME-FILE] ${msg}`;
    console.log(logMsg);
    if (data) console.log('  Data:', data);
    return logMsg;
  },

  cache(msg, data = null) {
    const logMsg = `[${getTimestamp()}] [GAME-CACHE] ${msg}`;
    console.log(logMsg);
    if (data) console.log('  Data:', data);
    return logMsg;
  },

  tdlight(msg, data = null) {
    const logMsg = `[${getTimestamp()}] [GAME-TDLIGHT] ${msg}`;
    console.log(logMsg);
    if (data) console.log('  Data:', data);
    return logMsg;
  },

  download(msg, data = null) {
    const logMsg = `[${getTimestamp()}] [GAME-DOWNLOAD] ${msg}`;
    console.log(logMsg);
    if (data) console.log('  Data:', data);
    return logMsg;
  },

  cleanup(msg, data = null) {
    const logMsg = `[${getTimestamp()}] [GAME-CLEANUP] ${msg}`;
    console.log(logMsg);
    if (data) console.log('  Data:', data);
    return logMsg;
  },

  error(msg, error = null) {
    const logMsg = `[${getTimestamp()}] [GAME-ERROR] ${msg}`;
    console.error(logMsg);
    if (error) {
      console.error('  Error Details:', error.message);
      if (error.stack) console.error('  Stack:', error.stack);
    }
    return logMsg;
  },

  warn(msg, data = null) {
    const logMsg = `[${getTimestamp()}] [GAME-WARN] ${msg}`;
    console.warn(logMsg);
    if (data) console.warn('  Warning Data:', data);
    return logMsg;
  },

  performance(msg, metrics = null) {
    const logMsg = `[${getTimestamp()}] [GAME-PERF] ${msg}`;
    console.log(logMsg);
    if (metrics) {
      console.log('  Metrics:', JSON.stringify(metrics, null, 2));
    }
    return logMsg;
  },

  request(req, startTime) {
    const duration = Date.now() - startTime;
    const logMsg = `[${getTimestamp()}] [GAME-REQUEST] ${req.method} ${req.path} - ${duration}ms`;
    console.log(logMsg);
    return {
      timestamp: getTimestamp(),
      method: req.method,
      path: req.path,
      duration,
      userAgent: req.headers['user-agent'] || 'unknown'
    };
  },

  memory() {
    const memoryUsage = process.memoryUsage();
    const format = (bytes) => `${(bytes / 1024 / 1024).toFixed(2)}MB`;
    
    const logMsg = `[${getTimestamp()}] [GAME-MEMORY] RSS: ${format(memoryUsage.rss)}, Heap: ${format(memoryUsage.heapUsed)}/${format(memoryUsage.heapTotal)}`;
    console.log(logMsg);
    
    return {
      timestamp: getTimestamp(),
      rss: memoryUsage.rss,
      heapUsed: memoryUsage.heapUsed,
      heapTotal: memoryUsage.heapTotal,
      external: memoryUsage.external
    };
  },

  cacheStats(stats) {
    const logMsg = `[${getTimestamp()}] [GAME-STATS] ${JSON.stringify(stats)}`;
    console.log(logMsg);
    return stats;
  },

  batch(operation, count, successCount, failureCount = 0) {
    const logMsg = `[${getTimestamp()}] [GAME-BATCH] ${operation}: 总数=${count}, 成功=${successCount}, 失败=${failureCount}, 成功率=${((successCount/count)*100).toFixed(1)}%`;
    console.log(logMsg);
    return logMsg;
  },

  // 🎯 导出 getTimestamp 供外部使用
  getTimestamp
};

// 🎯 只导出对象，不导出类
module.exports = GameLogger;