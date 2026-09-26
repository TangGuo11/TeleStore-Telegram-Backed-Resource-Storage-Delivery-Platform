//telegram/clearTelegramCache.js-清理聊天室数据被清理对应的缓存
const fs = require("fs");
const path = require("path");
const { 
  safeExecute, 
  getMessagesToDelete, 
  deleteCacheForMessages, 
  getDirectorySize, 
  formatFileSize, 
  clearDirectoryContents, 
  TELEGRAM_BASE_PATH, 
  CACHE_DIRS,
  withMongo,
  TYPE_DIR,
  getCacheFileName
} = require("./utils");

// Telegram 推送数据库
const TELEGRAM_DB_URI = process.env.TELEGRAM_DB_URI;
if (!TELEGRAM_DB_URI) throw new Error('TELEGRAM_DB_URI is not set');

/**
 * 模式1: 清理指定消息对应的缓存（与数据库删除配合使用）
 */
async function clearTargetedCache() {
  await safeExecute("清理指定消息缓存", async () => {
    // ★ 从共享数据中获取要清理的消息
    const messagesToDelete = getMessagesToDelete();
    
    console.log(`📋 [Telegram] 接收到 ${messagesToDelete.length} 条需要清理缓存的消息`);
    
    if (messagesToDelete.length > 0) {
      // ★ 清理这些消息对应的缓存文件
      const cacheResult = deleteCacheForMessages(messagesToDelete);
      console.log(`📊 [Telegram] 目标缓存清理完成: ${cacheResult.deletedFiles}/${cacheResult.totalFiles} 个文件`);
    } else {
      console.log("📭 [Telegram] 没有需要清理的目标缓存文件");
    }
  });
}

/**
 * 模式2: 清理整个缓存目录（原有的全量清理功能 - 谨慎使用）
 */
async function clearTelegramCache() {
  await safeExecute("清理Telegram缓存目录", async () => {
    console.log(`🧹 [Telegram] 开始清理Telegram缓存目录: ${TELEGRAM_BASE_PATH}`);
    
    let totalDeleted = 0;
    let totalErrors = 0;
    let totalInitialized = 0;
    let totalFreed = 0;

    for (const dir of CACHE_DIRS) {
      const dirPath = path.join(TELEGRAM_BASE_PATH, dir);
      console.log(`\n📁 [Telegram] 清理目录: ${dir}`);
      
      // 计算清理前大小
      const sizeBefore = getDirectorySize(dirPath);
      
      const result = clearDirectoryContents(dirPath);
      totalDeleted += result.deleted;
      totalErrors += result.errors;
      totalInitialized += result.initialized;
      
      // 计算清理后大小和实际释放空间
      const sizeAfter = getDirectorySize(dirPath);
      const freedSize = sizeBefore - sizeAfter;
      totalFreed += freedSize;
      
      console.log(`✅ [Telegram] ${dir} 清理结果:`);
      console.log(`  🗑️  删除 ${result.deleted} 个项目`);
      if (result.errors > 0) {
        console.log(`  ❌ ${result.errors} 个错误`);
      }
      if (result.initialized > 0) {
        console.log(`  📁 初始化目录`);
      }
      console.log(`  💾 释放 ${formatFileSize(freedSize)} (${formatFileSize(sizeBefore)} → ${formatFileSize(sizeAfter)})`);
    }

    console.log(`\n📊 [Telegram] 缓存目录清理总结:`);
    console.log(`  🗑️  总删除项目: ${totalDeleted}`);
    if (totalErrors > 0) {
      console.log(`  ❌ 总错误数: ${totalErrors}`);
    }
    if (totalInitialized > 0) {
      console.log(`  📁 初始化目录: ${totalInitialized}`);
    }
    console.log(`  💾 总释放空间: ${formatFileSize(totalFreed)}`);
    console.log(`🎉 [Telegram] 缓存目录清理完成 - 目录结构保持不变`);
  });
}

/**
 * 模式3: 清理孤立缓存文件（数据库中没有对应记录的文件）- 推荐方案
 */
async function clearOrphanedCache() {
  await safeExecute("清理孤立缓存文件", async () => {
    console.log(`🧹 [Telegram] 开始扫描孤立缓存文件...`);
    
    // 获取所有有效的文件ID
    const validFileIds = await getAllValidFileIds();
    console.log(`📊 [Telegram] 数据库中有 ${validFileIds.size} 个有效的缓存文件引用`);
    
    let totalScanned = 0;
    let totalOrphaned = 0;
    let totalDeleted = 0;
    let totalErrors = 0;
    let totalFreed = 0;

    // 检查每个缓存目录
    for (const [type, dirName] of Object.entries(TYPE_DIR)) {
      const dirPath = path.join(TELEGRAM_BASE_PATH, dirName);
      
      if (!fs.existsSync(dirPath)) {
        console.log(`📁 [Telegram] 目录不存在: ${dirPath}`);
        continue;
      }
      
      const files = fs.readdirSync(dirPath);
      console.log(`🔍 [Telegram] 扫描目录 ${dirName}: ${files.length} 个文件`);
      totalScanned += files.length;
      
      for (const file of files) {
        const filePath = path.join(dirPath, file);
        
        try {
          const stat = fs.statSync(filePath);
          if (stat.isFile()) {
            // 检查文件是否在有效文件列表中
            if (!validFileIds.has(file)) {
              totalOrphaned++;
              try {
                const fileSize = stat.size;
                fs.unlinkSync(filePath);
                totalDeleted++;
                totalFreed += fileSize;
                console.log(`🗑️ [Telegram] 删除孤立文件: ${dirName}/${file} (${formatFileSize(fileSize)})`);
              } catch (error) {
                console.error(`❌ [Telegram] 删除失败 ${filePath}:`, error.message);
                totalErrors++;
              }
            }
          }
        } catch (error) {
          console.error(`❌ [Telegram] 检查文件失败 ${filePath}:`, error.message);
          totalErrors++;
        }
      }
    }

    console.log(`\n📊 [Telegram] 孤立缓存清理完成:`);
    console.log(`  🔍 扫描文件总数: ${totalScanned} 个`);
    console.log(`  🎯 发现孤立文件: ${totalOrphaned} 个`);
    console.log(`  🗑️ 成功删除: ${totalDeleted} 个`);
    console.log(`  ❌ 删除失败: ${totalErrors} 个`);
    console.log(`  💾 释放空间: ${formatFileSize(totalFreed)}`);
    
    if (totalOrphaned === 0) {
      console.log(`🎉 [Telegram] 没有发现孤立缓存文件，数据一致性良好！`);
    } else {
      console.log(`🎉 [Telegram] 孤立缓存清理完成，数据一致性已优化！`);
    }
  });
}

/**
 * 从数据库获取所有有效的文件ID
 */
async function getAllValidFileIds() {
  return await withMongo(TELEGRAM_DB_URI, async (conn) => {
    const telegramMessagesCollection = conn.db.collection("telegrammessages");
    
    const validFileIds = new Set();
    
    try {
      // 查询所有包含媒体文件的消息
      const messages = await telegramMessagesCollection.find({
        $or: [
          { "photo.file_id": { $exists: true } },
          { "video.file_id": { $exists: true } },
          { "document.file_id": { $exists: true } }
        ]
      }).toArray();
      
      console.log(`📝 [Telegram] 查询到 ${messages.length} 条包含媒体文件的消息`);
      
      // 收集所有有效的文件ID
      for (const msg of messages) {
        if (msg.photo && msg.photo.file_id) {
          const fileName = getCacheFileName(msg, "photo");
          if (fileName) {
            validFileIds.add(fileName);
            console.log(`🔗 [Telegram] 有效照片文件: ${fileName}`);
          }
        }
        if (msg.video && msg.video.file_id) {
          const fileName = getCacheFileName(msg, "video");
          if (fileName) {
            validFileIds.add(fileName);
            console.log(`🔗 [Telegram] 有效视频文件: ${fileName}`);
          }
        }
        if (msg.document && msg.document.file_id) {
          const fileName = getCacheFileName(msg, "document");
          if (fileName) {
            validFileIds.add(fileName);
            console.log(`🔗 [Telegram] 有效文档文件: ${fileName}`);
          }
        }
      }
      
      return validFileIds;
    } catch (error) {
      console.error(`❌ [Telegram] 查询数据库失败:`, error.message);
      return new Set(); // 出错时返回空集合，避免误删文件
    }
  });
}

module.exports = {
  clearTargetedCache,  // 模式1: 清理指定消息缓存
  clearTelegramCache,  // 模式2: 全量清理缓存目录（谨慎使用）
  clearOrphanedCache   // 模式3: 清理孤立缓存文件（推荐方案）
};