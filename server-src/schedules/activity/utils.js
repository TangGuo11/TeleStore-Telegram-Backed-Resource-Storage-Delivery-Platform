//schedules/activity/utils.js
const mongoose = require("mongoose");

/**
 * 安全日志输出
 */
function log(level, message, ...args) {
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
    default:
      console.log(`📝 [${timestamp}]`, message, ...args);
  }
}

/**
 * 获取周一的Cron表达式 - 北京时间5:20
 * node-cron 5字段格式：分 时 日 月 星期
 */
function getMondayCron() {
  // 分(20) 时(5) 日(*) 月(*) 星期(1)
  return "20 5 * * 1";
}

/**
 * 用户数据库连接 - 专门连接USER_DB_URI
 */
async function withUserDB(taskFn) {
  const uri = process.env.USER_DB_URI;
  if (!uri) throw new Error('USER_DB_URI is not set');
  
  let conn;
  try {
    log('info', "🔗 [Activity] 连接用户数据库...");
    conn = await mongoose.createConnection(uri, {
      serverSelectionTimeoutMS: 15000,
      socketTimeoutMS: 30000,
      maxPoolSize: 1,
    }).asPromise();

    log('info', `✅ [Activity] 连接成功: ${conn.db.databaseName}`);
    
    return await taskFn(conn);
  } catch (error) {
    log('error', "❌ [Activity] 连接失败:", error.message);
    throw error;
  } finally {
    if (conn) {
      await conn.close();
      log('debug', "👋 [Activity] 连接已关闭");
    }
  }
}

/**
 * 安全执行任务 - 特别保护users集合
 */
async function safeExecute(taskName, taskFn) {
  const startTime = Date.now();
  
  try {
    log('info', `⏰ [${taskName}] 开始执行...`);
    const result = await taskFn();
    const duration = Date.now() - startTime;
    log('info', `✅ [${taskName}] 完成 - 耗时 ${duration}ms`);
    return result;
  } catch (error) {
    const duration = Date.now() - startTime;
    log('error', `❌ [${taskName}] 失败 (${duration}ms):`, error.message);
    throw error;
  }
}

module.exports = { 
  log, 
  getMondayCron, 
  withUserDB, 
  safeExecute 
};
