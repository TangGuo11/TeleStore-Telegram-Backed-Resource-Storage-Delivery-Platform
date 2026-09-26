//telegram/utils.js -聊天室专用工具
const mongoose = require("mongoose");
const fs = require("fs");
const path = require("path");

// 缓存目录映射
const TYPE_DIR = {
  photo: "photo",
  video: "video", 
  document: "documents"
};

const TELEGRAM_BASE_PATH = path.join(process.env.CACHE_DIR || path.join(process.cwd(), "downloads"), "telegram");

// 共享数据存储 - 用于任务间传递数据
const sharedData = {
  messagesToDelete: [] // 存储要删除的消息数据
};

/**
 * 设置要删除的消息数据（供 clearTelegramMessages 调用）
 */
function setMessagesToDelete(messages) {
  sharedData.messagesToDelete = messages || [];
}

/**
 * 获取要删除的消息数据（供 clearTelegramCache 调用）
 */
function getMessagesToDelete() {
  return [...sharedData.messagesToDelete]; // 返回副本
}

/**
 * 清空共享数据
 */
function clearSharedData() {
  sharedData.messagesToDelete = [];
}

/**
 * 根据消息记录生成缓存文件名
 */
function getCacheFileName(msg, type) {
  if (!msg[type]) return null;

  const fileId = msg[type].file_id;
  const fileUniqueId = msg[type].file_unique_id;
  
  if (!fileId || !fileUniqueId) return null;

  // 确定文件扩展名
  let ext = ".bin"; // 默认扩展名
  if (type === "photo") {
    ext = ".jpg";
  } else if (type === "video") {
    ext = ".mp4";
  } else if (type === "document" && msg[type].file_name) {
    ext = path.extname(msg[type].file_name);
  }

  // 构建文件名格式: fileId_fileUniqueId.ext
  return `${fileId}_${fileUniqueId}${ext}`;
}

/**
 * 根据消息记录获取完整的缓存文件路径
 */
function getCacheFilePath(msg, type) {
  const fileName = getCacheFileName(msg, type);
  if (!fileName) return null;

  const dir = TYPE_DIR[type];
  if (!dir) return null;

  return path.join(TELEGRAM_BASE_PATH, dir, fileName);
}

/**
 * 批量删除消息对应的缓存文件
 */
function deleteCacheForMessages(messages) {
  console.log(`🗑️ [Telegram] 开始清理被删除推送数据的缓存文件...`);

  let totalFiles = 0;
  let deletedFiles = 0;

  for (const msg of messages) {
    const types = ["photo", "video", "document"];
    
    for (const type of types) {
      if (msg[type]) {
        totalFiles++;
        const filePath = getCacheFilePath(msg, type);
        if (filePath && fs.existsSync(filePath)) {
          try {
            fs.unlinkSync(filePath);
            deletedFiles++;
            console.log(`✔ [Telegram] 删除缓存: ${path.basename(filePath)}`);
          } catch (error) {
            console.error(`❌ [Telegram] 删除失败: ${filePath}`, error.message);
          }
        }
      }
    }
  }

  console.log(`📊 [Telegram] 缓存清理完成：${deletedFiles} / ${totalFiles} 个文件已删除`);
  return { totalFiles, deletedFiles };
}

/**
 * 获取目录大小（同步版本）
 */
function getDirectorySize(dirPath) {
  if (!fs.existsSync(dirPath)) return 0;
  
  let totalSize = 0;
  
  try {
    const items = fs.readdirSync(dirPath);
    
    for (const item of items) {
      const itemPath = path.join(dirPath, item);
      const stat = fs.statSync(itemPath);
      
      if (stat.isDirectory()) {
        totalSize += getDirectorySize(itemPath);
      } else {
        totalSize += stat.size;
      }
    }
  } catch (error) {
    console.error(`❌ [Telegram] 计算目录大小失败 ${dirPath}:`, error.message);
  }
  
  return totalSize;
}

/**
 * 格式化文件大小
 */
function formatFileSize(bytes) {
  if (bytes === 0) return '0 B';
  
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * 清理目录内容但不删除目录本身
 */
function clearDirectoryContents(dirPath) {
  if (!fs.existsSync(dirPath)) {
    console.log(`📁 [Telegram] 目录不存在，创建目录: ${dirPath}`);
    fs.mkdirSync(dirPath, { recursive: true });
    return { deleted: 0, errors: 0, initialized: 1 };
  }

  let deleted = 0;
  let errors = 0;

  try {
    const items = fs.readdirSync(dirPath);
    
    if (items.length === 0) {
      console.log(`📭 [Telegram] 目录为空: ${dirPath}`);
      return { deleted: 0, errors: 0, initialized: 0 };
    }
    
    console.log(`🗑️ [Telegram] 清理目录 ${dirPath} 中的 ${items.length} 个项目`);
    
    for (const item of items) {
      const itemPath = path.join(dirPath, item);
      
      try {
        const stat = fs.statSync(itemPath);
        
        if (stat.isDirectory()) {
          // 对于子目录，递归删除整个子目录
          fs.rmSync(itemPath, { recursive: true, force: true });
          deleted++;
          console.log(`📁 [Telegram] 删除子目录: ${item}`);
        } else {
          // 删除文件
          fs.unlinkSync(itemPath);
          deleted++;
          console.log(`📄 [Telegram] 删除文件: ${item}`);
        }
      } catch (error) {
        console.error(`❌ [Telegram] 删除失败 ${item}:`, error.message);
        errors++;
      }
    }
    
    return { deleted, errors, initialized: 0 };
  } catch (error) {
    console.error(`❌ [Telegram] 读取目录失败 ${dirPath}:`, error.message);
    return { deleted: 0, errors: 1, initialized: 0 };
  }
}

/**
 * 聊天室专用日志函数
 */
function log(level, message, ...args) {
  const timestamp = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
  
  switch (level) {
    case 'error':
      console.error(`❌ [${timestamp}] [Telegram]`, message, ...args);
      break;
    case 'warn':
      console.warn(`⚠️ [${timestamp}] [Telegram]`, message, ...args);
      break;
    case 'info':
      console.log(`📝 [${timestamp}] [Telegram]`, message, ...args);
      break;
    case 'debug':
      console.log(`🔍 [${timestamp}] [Telegram]`, message, ...args);
      break;
    default:
      console.log(`📝 [${timestamp}] [Telegram]`, message, ...args);
  }
}

/**
 * 获取Cron表达式
 */
function getBeijingCron(hour, minute) {
  return `${minute} ${hour} * * *`;
}

/**
 * 独立MongoDB连接执行任务
 */
async function withMongo(uri, taskFn) {
  const timestamp = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
  let conn;
  try {
    console.log(`🔗 [${timestamp}] [Telegram] [Mongo] 正在建立独立连接...`);
    conn = await mongoose.createConnection(uri, {
      serverSelectionTimeoutMS: 10000,
      socketTimeoutMS: 30000,
      maxPoolSize: 1,
    }).asPromise();

    console.log(`✅ [${timestamp}] [Telegram] [Mongo] 已连接到数据库: ${conn.db.databaseName}`);
    
    return await taskFn(conn);
  } catch (error) {
    console.error(`❌ [${timestamp}] [Telegram] [Mongo] 连接或执行失败:`, error);
    throw error;
  } finally {
    if (conn) {
      await conn.close();
      console.log(`👋 [${timestamp}] [Telegram] [Mongo] 已关闭独立连接`);
    }
  }
}

/**
 * 安全执行任务包装器
 */
async function safeExecute(taskName, taskFn) {
  const startTime = Date.now();
  const beijingTime = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
  
  try {
    console.log(`🌅 [${beijingTime}] [Telegram] ⏰ [${taskName}] 开始执行...`);
    await taskFn();
    const duration = Date.now() - startTime;
    console.log(`✅ [${beijingTime}] [Telegram] [${taskName}] 执行完成 - 耗时 ${duration}ms`);
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`❌ [${beijingTime}] [Telegram] [${taskName}] 执行失败 (${duration}ms):`, error.message);
  }
}

module.exports = { 
  log,
  getBeijingCron, 
  withMongo, 
  safeExecute,
  // 新增的缓存管理函数
  setMessagesToDelete,
  getMessagesToDelete,
  clearSharedData,
  getCacheFileName,
  getCacheFilePath,
  deleteCacheForMessages,
  getDirectorySize,
  formatFileSize,
  clearDirectoryContents,
  TYPE_DIR,
  TELEGRAM_BASE_PATH,
  CACHE_DIRS: ["photo", "video", "documents"]
};