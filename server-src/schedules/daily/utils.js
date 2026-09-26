//daily/utils.js-公共工具
const mongoose = require("mongoose");
const cron = require("node-cron");

/**
 * 根据环境变量控制日志输出
 */
function log(level, message, ...args) {
  const isProduction = process.env.NODE_ENV === 'production';
  
  // 生产环境只输出 error 和重要信息
  if (isProduction && level === 'debug') {
    return;
  }
  
  const timestamp = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
  
  switch (level) {
    case 'error':
      console.error(`❌ [${timestamp}]`, message, ...args);
      break;
    case 'warn':
      console.warn(`⚠️ [${timestamp}]`, message, ...args);
      break;
    case 'info':
      console.log(`📝 [${timestamp}]`, message, ...args);
      break;
    case 'debug':
      console.log(`🔍 [${timestamp}]`, message, ...args);
      break;
    default:
      console.log(`📝 [${timestamp}]`, message, ...args);
  }
}

/**
 * 获取Cron表达式
 * node-cron 5字段格式：分 时 日 月 星期
 * 已经在 cron.schedule 中设置了 timezone: "Asia/Shanghai"，所以直接使用北京时间
 */
function getBeijingCron(hour, minute) {
  // 5字段格式：分 时 日 月 星期
  return `${minute} ${hour} * * *`;
}

/**
 * 独立MongoDB连接执行任务 - 优化连接管理
 */
async function withMongo(taskFn) {
  const uri = process.env.MONGO_URI || process.env.TEST_DB_URI;
  if (!uri) throw new Error('MONGO_URI / TEST_DB_URI is not set');
  
  let conn;
  try {
    log('debug', "🔗 [Mongo] 正在建立独立连接...");
    conn = await mongoose.createConnection(uri, {
      serverSelectionTimeoutMS: 10000,
      socketTimeoutMS: 30000,
      maxPoolSize: 1,
    }).asPromise();

    log('debug', `✅ [Mongo] 已连接到数据库: ${conn.db.databaseName}`);
    
    // 执行具体任务
    return await taskFn(conn);
  } catch (error) {
    log('error', "❌ [Mongo] 连接或执行失败:", error);
    throw error;
  } finally {
    if (conn) {
      await conn.close();
      log('debug', "👋 [Mongo] 已关闭独立连接");
      
      // 移除手动清理连接引用的代码，让 mongoose 自己管理
      // mongoose.connections = mongoose.connections.filter(c => c.id !== conn.id);
    }
  }
}

/**
 * 安全执行任务包装器 - 带耗时监控
 */
async function safeExecute(taskName, taskFn) {
  const startTime = Date.now();
  const beijingTime = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
  
  try {
    log('info', `🌅 [${beijingTime}] ⏰ [${taskName}] 开始执行...`);
    await taskFn();
    const duration = Date.now() - startTime;
    log('info', `✅ [${taskName}] 执行完成 - 耗时 ${duration}ms`);
  } catch (error) {
    const duration = Date.now() - startTime;
    log('error', `❌ [${taskName}] 执行失败 (${duration}ms):`, error.message);
  }
}

module.exports = { 
  log,
  getBeijingCron, 
  withMongo, 
  safeExecute 
};