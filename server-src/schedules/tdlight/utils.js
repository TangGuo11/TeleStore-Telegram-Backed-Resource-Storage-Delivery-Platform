//tdlight/utils.js -TDLight 专用工具
const fs = require("fs");
const path = require("path");

/**
 * TDLight 专用日志函数
 */
function log(level, message, ...args) {
  const timestamp = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
  
  switch (level) {
    case 'error':
      console.error(`❌ [${timestamp}] [TDLight]`, message, ...args);
      break;
    case 'warn':
      console.warn(`⚠️ [${timestamp}] [TDLight]`, message, ...args);
      break;
    case 'info':
      console.log(`📝 [${timestamp}] [TDLight]`, message, ...args);
      break;
    case 'debug':
      console.log(`🔍 [${timestamp}] [TDLight]`, message, ...args);
      break;
    default:
      console.log(`📝 [${timestamp}] [TDLight]`, message, ...args);
  }
}

/**
 * 获取Cron表达式
 */
function getBeijingCron(hour, minute) {
  return `${minute} ${hour} * * *`;
}

/**
 * 安全执行任务包装器
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
 * 异步递归扫描目录中的所有符号链接（性能优化）
 */
async function scanSymbolicLinksAsync(dirPath, progressCallback = null) {
  const resultSet = new Set();
  let scannedDirs = 0;
  let scannedFiles = 0;
  let skippedEnoent = 0;
  
  async function scanRecursive(currentPath) {
    if (!fs.existsSync(currentPath)) {
      log('debug', `目录不存在: ${currentPath}`);
      return;
    }

    try {
      const items = await fs.promises.readdir(currentPath);
      scannedDirs++;
      
      // 批量处理项目，提高性能
      const batchSize = 100; // 每批处理100个文件
      for (let i = 0; i < items.length; i += batchSize) {
        const batch = items.slice(i, i + batchSize);
        
        await Promise.all(batch.map(async (item) => {
          const itemPath = path.join(currentPath, item);
          
          try {
            const stats = await fs.promises.lstat(itemPath);
            scannedFiles++;
            
            // 每扫描1000个文件报告一次进度
            if (scannedFiles % 1000 === 0 && progressCallback) {
              progressCallback(scannedDirs, scannedFiles);
            }
            
            if (stats.isSymbolicLink()) {
              // 获取符号链接指向的真实路径
              const realPath = await fs.promises.realpath(itemPath);
              resultSet.add(realPath);
              
              // 减少日志输出，只在调试模式下输出详细日志
              if (scannedFiles <= 10) { // 只输出前10个作为示例
                log('debug', `🔗 发现软链接: ${item} → ${realPath}`);
              }
            } else if (stats.isDirectory()) {
              // 递归扫描子目录
              await scanRecursive(itemPath);
            }
          } catch (error) {
            if (error.code === 'ENOENT') {
              // 扫描期间目标被并发清理属于预期情况，降级为 debug 并计数
              skippedEnoent++;
              log('debug', `扫描项目跳过(ENOENT) ${itemPath}:`, error.message);
            } else {
              log('error', `扫描项目失败 ${itemPath}:`, error.message);
            }
          }
        }));
      }
    } catch (error) {
      log('error', `读取目录失败 ${currentPath}:`, error.message);
    }
  }
  
  log('info', `开始异步扫描目录: ${dirPath}`);
  await scanRecursive(dirPath);
  
  if (progressCallback) {
    progressCallback(scannedDirs, scannedFiles);
  }
  
  if (skippedEnoent > 0) {
    log('info', `扫描符号链接时跳过 ENOENT: ${skippedEnoent} 个`);
  }
  
  return resultSet;
}

/**
 * 异步递归扫描目录中的所有真实文件（性能优化）
 */
async function scanRealFilesAsync(dirPath, progressCallback = null) {
  const resultSet = new Set();
  let scannedDirs = 0;
  let scannedFiles = 0;
  let skippedEnoent = 0;
  
  async function scanRecursive(currentPath) {
    if (!fs.existsSync(currentPath)) {
      log('debug', `目录不存在: ${currentPath}`);
      return;
    }

    try {
      const items = await fs.promises.readdir(currentPath);
      scannedDirs++;
      
      // 批量处理项目
      const batchSize = 100;
      for (let i = 0; i < items.length; i += batchSize) {
        const batch = items.slice(i, i + batchSize);
        
        await Promise.all(batch.map(async (item) => {
          const itemPath = path.join(currentPath, item);
          
          try {
            const stats = await fs.promises.lstat(itemPath);
            scannedFiles++;
            
            // 进度报告
            if (scannedFiles % 1000 === 0 && progressCallback) {
              progressCallback(scannedDirs, scannedFiles);
            }
            
            if (stats.isFile() && !stats.isSymbolicLink()) {
              // 只添加真实文件，排除符号链接
              resultSet.add(itemPath);
              
              // 减少日志输出
              if (scannedFiles <= 10) {
                log('debug', `📄 发现真实文件: ${itemPath}`);
              }
            } else if (stats.isDirectory() && !stats.isSymbolicLink()) {
              // 递归扫描子目录（排除符号链接目录）
              await scanRecursive(itemPath);
            }
          } catch (error) {
            if (error.code === 'ENOENT') {
              // 扫描期间文件被并发清理属于预期情况，降级为 debug 并计数
              skippedEnoent++;
              log('debug', `扫描项目跳过(ENOENT) ${itemPath}:`, error.message);
            } else {
              log('error', `扫描项目失败 ${itemPath}:`, error.message);
            }
          }
        }));
      }
    } catch (error) {
      log('error', `读取目录失败 ${currentPath}:`, error.message);
    }
  }
  
  log('info', `开始异步扫描目录: ${dirPath}`);
  await scanRecursive(dirPath);
  
  if (progressCallback) {
    progressCallback(scannedDirs, scannedFiles);
  }
  
  if (skippedEnoent > 0) {
    log('info', `扫描真实文件时跳过 ENOENT: ${skippedEnoent} 个`);
  }
  
  return resultSet;
}

/**
 * 安全删除文件（增强版本）
 */
function safeDeleteFile(filePath) {
  try {
    const stats = fs.lstatSync(filePath);
    
    // 详细文件类型检查
    const fileType = getFileType(stats);
    
    if (fileType !== 'file') {
      log('warn', `跳过非普通文件: ${filePath} (类型: ${fileType})`);
      return { 
        success: false, 
        reason: 'not_regular_file',
        type: fileType
      };
    }
    
    const fileSize = stats.size;
    fs.unlinkSync(filePath);
    
    log('info', `🗑️ 删除孤儿缓存: ${path.basename(filePath)} (${formatFileSize(fileSize)})`);
    return { 
      success: true, 
      size: fileSize,
      type: fileType
    };
  } catch (error) {
    if (error.code === 'ENOENT') {
      log('debug', `文件已不存在: ${filePath}`);
      return { 
        success: false, 
        reason: 'already_deleted' 
      };
    } else {
      log('error', `删除失败 ${filePath}:`, error.message);
      return { 
        success: false, 
        reason: error.code || 'unknown' 
      };
    }
  }
}

/**
 * 获取详细文件类型
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
 * 批量安全删除文件（并行处理）
 */
async function safeDeleteFilesBatch(filePaths, batchSize = 50) {
  const results = {
    deleted: 0,
    errors: 0,
    freed: 0,
    skipped: {
      not_regular_file: 0,
      already_deleted: 0,
      unknown: 0
    },
    types: {
      file: 0,
      directory: 0,
      symlink: 0,
      block_device: 0,
      character_device: 0,
      fifo: 0,
      socket: 0,
      unknown: 0
    }
  };
  
  log('info', `开始批量删除 ${filePaths.length} 个文件，批次大小: ${batchSize}`);
  
  for (let i = 0; i < filePaths.length; i += batchSize) {
    const batch = filePaths.slice(i, i + batchSize);
    
    // 并行处理批次
    const batchResults = await Promise.all(
      batch.map(async (filePath) => {
        return safeDeleteFile(filePath);
      })
    );
    
    // 统计批次结果
    batchResults.forEach(result => {
      if (result.success) {
        results.deleted++;
        results.freed += result.size;
        results.types[result.type] = (results.types[result.type] || 0) + 1;
      } else {
        results.errors++;
        results.skipped[result.reason] = (results.skipped[result.reason] || 0) + 1;
        if (result.type) {
          results.types[result.type] = (results.types[result.type] || 0) + 1;
        }
      }
    });
    
    // 报告批次进度
    const progress = ((i + batch.length) / filePaths.length * 100).toFixed(1);
    log('info', `删除进度: ${progress}% (${i + batch.length}/${filePaths.length})`);
  }
  
  return results;
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

module.exports = { 
  log,
  getBeijingCron, 
  safeExecute,
  scanSymbolicLinksAsync,
  scanRealFilesAsync,
  safeDeleteFile,
  safeDeleteFilesBatch,
  formatFileSize,
  getFileType
};