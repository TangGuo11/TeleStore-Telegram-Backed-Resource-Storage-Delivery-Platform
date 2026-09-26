//daily/clearDailyCache.js-清理 daily 缓存文件夹
const fs = require("fs");
const path = require("path");
const { safeExecute, log } = require("./utils");

const DAILY_BASE_PATH = path.join(process.env.CACHE_DIR || path.join(process.cwd(), "downloads"), "daily");
const CACHE_DIRS = ["photo", "video", "documents"];

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
    log('error', `❌ 计算目录大小失败 ${dirPath}:`, error.message);
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
    log('info', `📁 目录不存在，创建目录: ${dirPath}`);
    fs.mkdirSync(dirPath, { recursive: true });
    return { deleted: 0, errors: 0, initialized: 1 }; // 改为 initialized
  }

  let deleted = 0;
  let errors = 0;

  try {
    const items = fs.readdirSync(dirPath);
    
    if (items.length === 0) {
      log('debug', `📭 目录为空: ${dirPath}`);
      return { deleted: 0, errors: 0, initialized: 0 };
    }
    
    log('info', `🗑️ 清理目录 ${dirPath} 中的 ${items.length} 个项目`);
    
    for (const item of items) {
      const itemPath = path.join(dirPath, item);
      
      try {
        const stat = fs.statSync(itemPath);
        
        if (stat.isDirectory()) {
          // 对于子目录，递归删除整个子目录
          fs.rmSync(itemPath, { recursive: true, force: true });
          deleted++;
          log('debug', `📁 删除子目录: ${item}`);
        } else {
          // 删除文件
          fs.unlinkSync(itemPath);
          deleted++;
          log('debug', `📄 删除文件: ${item}`);
        }
      } catch (error) {
        log('error', `❌ 删除失败 ${item}:`, error.message);
        errors++;
      }
    }
    
    return { deleted, errors, initialized: 0 };
  } catch (error) {
    log('error', `❌ 读取目录失败 ${dirPath}:`, error.message);
    return { deleted: 0, errors: 1, initialized: 0 };
  }
}

async function clearDailyCache() {
  await safeExecute("清理Daily缓存", async () => {
    log('info', `🧹 开始清理日更缓存目录: ${DAILY_BASE_PATH}`);
    
    let totalDeleted = 0;
    let totalErrors = 0;
    let totalInitialized = 0;
    let totalFreed = 0;

    for (const dir of CACHE_DIRS) {
      const dirPath = path.join(DAILY_BASE_PATH, dir);
      log('info', `\n📁 清理目录: ${dir}`);
      
      // 计算清理前大小
      const sizeBefore = getDirectorySize(dirPath);
      
      const result = clearDirectoryContents(dirPath);
      totalDeleted += result.deleted;
      totalErrors += result.errors;
      totalInitialized += result.initialized;
      
      // 计算清理后大小
      const sizeAfter = getDirectorySize(dirPath);
      const freedSize = sizeBefore - sizeAfter; // 正确计算释放空间
      totalFreed += freedSize;
      
      log('info', `✅ ${dir} 清理结果:`);
      log('info', `  🗑️  删除 ${result.deleted} 个项目`);
      if (result.errors > 0) {
        log('warn', `  ❌ ${result.errors} 个错误`);
      }
      if (result.initialized > 0) {
        log('info', `  📁 初始化目录`);
      }
      log('info', `  💾 释放 ${formatFileSize(freedSize)} (${formatFileSize(sizeBefore)} → ${formatFileSize(sizeAfter)})`);
    }

    log('info', `\n📊 缓存清理总结:`);
    log('info', `  🗑️  总删除项目: ${totalDeleted}`);
    if (totalErrors > 0) {
      log('warn', `  ❌ 总错误数: ${totalErrors}`);
    }
    if (totalInitialized > 0) {
      log('info', `  📁 初始化目录: ${totalInitialized}`);
    }
    log('info', `  💾 总释放空间: ${formatFileSize(totalFreed)}`);
    log('info', `🎉 日更缓存清理完成 - 目录结构保持不变`);
  });
}

module.exports = clearDailyCache;