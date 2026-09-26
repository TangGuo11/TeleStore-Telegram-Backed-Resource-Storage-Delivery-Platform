//works/utils.js - 作品专用工具

const fs = require("fs");
const path = require("path");

/**
 * 作品专用日志函数 - 独立实现
 */
function log(level, message, ...args) {
  const timestamp = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
  
  switch (level) {
    case 'error':
      console.error(`❌ [${timestamp}] [Works]`, message, ...args);
      break;
    case 'warn':
      console.warn(`⚠️ [${timestamp}] [Works]`, message, ...args);
      break;
    case 'info':
      console.log(`📝 [${timestamp}] [Works]`, message, ...args);
      break;
    case 'debug':
      console.log(`🔍 [${timestamp}] [Works]`, message, ...args);
      break;
    default:
      console.log(`📝 [${timestamp}] [Works]`, message, ...args);
  }
}

/**
 * 获取Cron表达式 - 独立实现
 */
function getBeijingCron(hour, minute) {
  return `${minute} ${hour} * * *`;
}

/**
 * 安全执行任务包装器 - 独立实现
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
      const stat = fs.lstatSync(itemPath); // 使用 lstatSync 不跟随符号链接
      
      if (stat.isDirectory() && !stat.isSymbolicLink()) {
        totalSize += getDirectorySize(itemPath);
      } else if (stat.isFile() || stat.isSymbolicLink()) {
        totalSize += stat.size;
      }
    }
  } catch (error) {
    log('error', `计算目录大小失败 ${dirPath}:`, error.message);
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
 * 检查文件系统 atime 支持情况
 */
function checkAtimeSupport() {
  try {
    const testDir = "/tmp";
    const testFile = path.join(testDir, `atime_test_${Date.now()}`);
    
    // 创建测试文件
    fs.writeFileSync(testFile, "test");
    
    // 获取初始 atime
    const initialStats = fs.statSync(testFile);
    const initialAtime = initialStats.atimeMs;
    
    // 读取文件以更新 atime
    fs.readFileSync(testFile);
    
    // 再次获取 atime
    const afterStats = fs.statSync(testFile);
    const afterAtime = afterStats.atimeMs;
    
    // 清理测试文件
    fs.unlinkSync(testFile);
    
    const atimeUpdated = afterAtime > initialAtime;
    
    if (!atimeUpdated) {
      log('warn', `⚠️ 系统可能挂载为 noatime/relatime，atime 未更新 (${initialAtime} -> ${afterAtime})`);
      log('warn', `⚠️ 将使用 mtime/ctime 作为文件活跃度判断依据`);
    } else {
      log('debug', `✅ 系统支持 atime 更新 (${initialAtime} -> ${afterAtime})`);
    }
    
    return atimeUpdated;
  } catch (error) {
    log('warn', `⚠️ 无法检测 atime 支持情况:`, error.message);
    return false;
  }
}

/**
 * 检查文件是否超过指定天数未被访问（安全版本）
 */
function isFileOlderThanDays(filePath, days) {
  try {
    // 使用 lstat 不跟随符号链接
    const stats = fs.lstatSync(filePath);
    const now = Date.now();
    
    // 检查是否为符号链接
    if (stats.isSymbolicLink()) {
      log('debug', `🔗 检测到符号链接: ${filePath}`);
      // 对于符号链接，我们只检查链接本身的时间，不跟随目标
      const linkTime = Math.max(stats.atimeMs, stats.mtimeMs, stats.ctimeMs);
      const daysInMs = days * 24 * 60 * 60 * 1000;
      return (now - linkTime) > daysInMs;
    }
    
    // 对于普通文件，使用最可靠的时间判断
    // 优先使用 atime，如果不支持则回退到 mtime/ctime
    const fileTime = Math.max(
      stats.atimeMs, // 访问时间（可能因 noatime 不更新）
      stats.mtimeMs, // 修改时间
      stats.ctimeMs  // 状态改变时间
    );
    
    const daysInMs = days * 24 * 60 * 60 * 1000;
    const isOld = (now - fileTime) > daysInMs;
    
    if (isOld) {
      log('debug', `📅 文件 ${path.basename(filePath)} 最后活跃: ${new Date(fileTime).toLocaleString('zh-CN')}`);
    }
    
    return isOld;
  } catch (error) {
    if (error.code === 'ENOENT') {
      log('debug', `文件已不存在: ${filePath}`);
    } else {
      log('error', `检查文件时间失败 ${filePath}:`, error.message);
    }
    return false;
  }
}

/**
 * 安全删除文件（处理各种文件类型）
 */
function safeDeleteFile(filePath, stats) {
  try {
    if (stats.isSymbolicLink()) {
      // 只删除符号链接本身，不跟随目标
      fs.unlinkSync(filePath);
      log('debug', `🔗 删除符号链接: ${path.basename(filePath)}`);
      return { success: true, type: 'symlink' };
    } else if (stats.isFile()) {
      // 删除普通文件
      fs.unlinkSync(filePath);
      log('debug', `📄 删除文件: ${path.basename(filePath)}`);
      return { success: true, type: 'file' };
    } else if (stats.isDirectory()) {
      // 不删除目录，只记录警告
      log('warn', `⚠️ 跳过目录: ${path.basename(filePath)} (目录清理需要特殊处理)`);
      return { success: false, type: 'directory', reason: 'skip_directory' };
    } else {
      // 其他特殊文件类型
      log('warn', `⚠️ 跳过特殊文件: ${path.basename(filePath)} (类型: ${getFileType(stats)})`);
      return { success: false, type: getFileType(stats), reason: 'special_file' };
    }
  } catch (error) {
    if (error.code === 'ENOENT') {
      log('debug', `文件已不存在: ${filePath}`);
      return { success: false, reason: 'already_deleted' };
    } else {
      log('error', `删除失败 ${filePath}:`, error.message);
      return { success: false, reason: error.code || 'unknown' };
    }
  }
}

/**
 * 获取文件类型描述
 */
function getFileType(stats) {
  if (stats.isFile()) return 'file';
  if (stats.isDirectory()) return 'directory';
  if (stats.isSymbolicLink()) return 'symlink';
  if (stats.isBlockDevice()) return 'block_device';
  if (stats.isCharacterDevice()) return 'character_device';
  if (stats.isFIFO()) return 'fifo';
  if (stats.isSocket()) return 'socket';
  return 'unknown';
}

/**
 * 递归清理目录中超过指定天数的文件（安全版本）
 */
function clearOldFilesRecursive(dirPath, maxAgeDays) {
  if (!fs.existsSync(dirPath)) {
    log('info', `目录不存在: ${dirPath}`);
    return { deleted: 0, errors: 0, freed: 0, symlinks: 0, skipped: 0 };
  }

  let deleted = 0;
  let errors = 0;
  let freed = 0;
  let symlinks = 0;
  let skipped = 0;

  try {
    const items = fs.readdirSync(dirPath);
    
    if (items.length === 0) {
      log('debug', `目录为空: ${dirPath}`);
      return { deleted: 0, errors: 0, freed: 0, symlinks: 0, skipped: 0 };
    }
    
    log('info', `扫描目录 ${dirPath} 中的 ${items.length} 个项目`);
    
    // 在开始扫描前检查 atime 支持情况
    if (deleted === 0 && errors === 0) { // 只在第一次调用时检查
      checkAtimeSupport();
    }
    
    for (const item of items) {
      const itemPath = path.join(dirPath, item);
      
      try {
        // 使用 lstat 不跟随符号链接
        const stats = fs.lstatSync(itemPath);
        
        if (stats.isDirectory() && !stats.isSymbolicLink()) {
          // 递归处理子目录（非符号链接目录）
          const result = clearOldFilesRecursive(itemPath, maxAgeDays);
          deleted += result.deleted;
          errors += result.errors;
          freed += result.freed;
          symlinks += result.symlinks;
          skipped += result.skipped;
        } else {
          // 检查文件/符号链接是否超过指定天数
          if (isFileOlderThanDays(itemPath, maxAgeDays)) {
            const deleteResult = safeDeleteFile(itemPath, stats);
            
            if (deleteResult.success) {
              deleted++;
              freed += stats.size;
              if (deleteResult.type === 'symlink') {
                symlinks++;
              }
            } else {
              if (deleteResult.reason === 'skip_directory' || deleteResult.reason === 'special_file') {
                skipped++;
              } else {
                errors++;
              }
            }
          }
        }
      } catch (error) {
        if (error.code === 'ENOENT') {
          log('debug', `文件已不存在: ${itemPath}`);
        } else {
          log('error', `处理失败 ${item}:`, error.message);
          errors++;
        }
      }
    }
    
    return { deleted, errors, freed, symlinks, skipped };
  } catch (error) {
    log('error', `读取目录失败 ${dirPath}:`, error.message);
    return { deleted: 0, errors: 1, freed: 0, symlinks: 0, skipped: 0 };
  }
}

module.exports = { 
  log,
  getBeijingCron, 
  safeExecute,
  getDirectorySize,
  formatFileSize,
  isFileOlderThanDays,
  clearOldFilesRecursive,
  checkAtimeSupport
};