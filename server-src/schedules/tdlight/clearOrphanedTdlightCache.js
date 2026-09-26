//tdlight/clearOrphanedTdlightCache.js-清理孤儿缓存
const path = require("path");
const { safeExecute, scanSymbolicLinksAsync, scanRealFilesAsync, safeDeleteFilesBatch, formatFileSize, log } = require("./utils");

const CACHE_DIR = process.env.CACHE_DIR || path.join(process.cwd(), "downloads");
const BOT_CACHE_DIR = process.env.FORWARD_BOT_DIR || process.env.BOT_TOKEN || "tdlight";

const BUSINESS_DIRS = [
  path.join(CACHE_DIR, "daily/photo"),
  path.join(CACHE_DIR, "daily/video"),
  path.join(CACHE_DIR, "daily/documents"),
  path.join(CACHE_DIR, "works/video"),
  path.join(CACHE_DIR, "telegram/photo"),
  path.join(CACHE_DIR, "telegram/video"),
  path.join(CACHE_DIR, "telegram/documents")
];

const TDLIGHT_CACHE_DIRS = [
  path.join(CACHE_DIR, BOT_CACHE_DIR, "thumbnails"),
  path.join(CACHE_DIR, BOT_CACHE_DIR, "videos"),
  path.join(CACHE_DIR, BOT_CACHE_DIR, "documents")
];

async function clearOrphanedTdlightCache() {
  await safeExecute("清理TDLight孤儿缓存", async () => {
    log('info', '🧹 开始扫描TDLight孤儿缓存文件...');
    log('info', '📋 方案: 通过业务软链接引用关系找出未被引用的真实缓存文件');
    
    let totalScannedDirs = 0;
    let totalScannedFiles = 0;
    
    // 进度回调函数
    const progressCallback = (dirs, files) => {
      totalScannedDirs = dirs;
      totalScannedFiles = files;
      log('debug', `扫描进度: ${dirs} 个目录, ${files} 个文件`);
    };
    
    // ★ 步骤1: 异步扫描所有业务目录的软链接
    log('info', '\n📝 步骤1: 异步扫描业务目录中的软链接...');
    const linkedCache = new Set();
    
    for (const businessDir of BUSINESS_DIRS) {
      log('info', `🔍 扫描业务目录: ${businessDir}`);
      const businessLinks = await scanSymbolicLinksAsync(businessDir, progressCallback);
      businessLinks.forEach(link => linkedCache.add(link));
    }
    
    log('info', `📊 扫描完成: 发现 ${linkedCache.size} 个被软链接引用的真实文件`);
    log('info', `📈 扫描统计: ${totalScannedDirs} 个目录, ${totalScannedFiles} 个文件`);
    
    // ★ 步骤2: 异步扫描 TDLight 真实缓存目录
    log('info', '\n📝 步骤2: 异步扫描TDLight真实缓存目录...');
    const actualCache = new Set();
    totalScannedDirs = 0;
    totalScannedFiles = 0;
    
    for (const tdlightDir of TDLIGHT_CACHE_DIRS) {
      log('info', `🔍 扫描TDLight目录: ${tdlightDir}`);
      const tdlightFiles = await scanRealFilesAsync(tdlightDir, progressCallback);
      tdlightFiles.forEach(file => actualCache.add(file));
    }
    
    log('info', `📊 扫描完成: 发现 ${actualCache.size} 个TDLight真实缓存文件`);
    log('info', `📈 扫描统计: ${totalScannedDirs} 个目录, ${totalScannedFiles} 个文件`);
    
    // ★ 步骤3: 比对找出"孤儿"缓存
    log('info', '\n📝 步骤3: 比对找出孤儿缓存文件...');
    const orphanedFiles = [];
    
    for (const actualFile of actualCache) {
      if (!linkedCache.has(actualFile)) {
        orphanedFiles.push(actualFile);
      }
    }
    
    log('info', `🎯 比对完成: 发现 ${orphanedFiles.length} 个孤儿缓存文件`);
    
    // 显示一些统计信息
    if (orphanedFiles.length > 0) {
      log('info', '\n📋 孤儿缓存文件示例 (前5个):');
      orphanedFiles.slice(0, 5).forEach((file, index) => {
        log('info', `  ${index + 1}. ${file}`);
      });
      if (orphanedFiles.length > 5) {
        log('info', `  ... 还有 ${orphanedFiles.length - 5} 个文件`);
      }
    }
    
    // ★ 步骤4: 批量安全删除孤儿缓存文件
    log('info', '\n📝 步骤4: 批量安全删除孤儿缓存文件...');
    const deleteResults = await safeDeleteFilesBatch(orphanedFiles, 50);
    
    // ★ 输出清理总结
    log('info', '\n📊 TDLight孤儿缓存清理总结:');
    log('info', `  🔗 被引用的文件: ${linkedCache.size} 个`);
    log('info', `  📄 TDLight缓存文件: ${actualCache.size} 个`);
    log('info', `  🎯 发现的孤儿文件: ${orphanedFiles.length} 个`);
    log('info', `  🗑️  成功删除: ${deleteResults.deleted} 个`);
    log('info', `  💾 释放空间: ${formatFileSize(deleteResults.freed)}`);
    
    if (deleteResults.errors > 0) {
      log('warn', `  ❌ 删除错误: ${deleteResults.errors} 个`);
    }
    
    // 显示跳过的文件类型统计
    const skippedReasons = Object.entries(deleteResults.skipped)
      .filter(([reason, count]) => count > 0)
      .map(([reason, count]) => `${reason}: ${count}`)
      .join(', ');
    
    if (skippedReasons) {
      log('info', `  ⏭️  跳过文件: ${skippedReasons}`);
    }
    
    // 显示文件类型统计
    const fileTypes = Object.entries(deleteResults.types)
      .filter(([type, count]) => count > 0)
      .map(([type, count]) => `${type}: ${count}`)
      .join(', ');
    
    if (fileTypes) {
      log('info', `  📁 文件类型: ${fileTypes}`);
    }
    
    if (orphanedFiles.length === 0) {
      log('info', '🎉 没有发现孤儿缓存文件，所有TDLight缓存都被业务引用！');
    } else {
      log('info', `🎉 TDLight孤儿缓存清理完成！清理了 ${deleteResults.deleted} 个未被引用的文件`);
    }
    
    // 计算缓存利用率（增强版本）
    const totalReferencedFiles = linkedCache.size;
    const totalCacheFiles = actualCache.size;
    
    if (totalCacheFiles > 0) {
      const cacheUtilization = ((totalCacheFiles - orphanedFiles.length) / totalCacheFiles * 100).toFixed(2);
      log('info', `📈 缓存利用率: ${cacheUtilization}% (${totalCacheFiles - orphanedFiles.length}/${totalCacheFiles} 个文件被引用)`);
      
      // 添加利用率警告
      if (cacheUtilization < 10) {
        log('warn', `⚠️  缓存利用率过低! 可能原因:`);
        log('warn', `   - 业务软链接已被清理`);
        log('warn', `   - TDLight缓存文件未被正确引用`);
        log('warn', `   - 扫描配置可能有误`);
      } else if (cacheUtilization < 50) {
        log('info', `💡 缓存利用率较低，建议检查业务引用关系`);
      }
    } else {
      log('info', `📈 缓存利用率: 100% (没有TDLight缓存文件)`);
    }
    
    // 性能统计
    const referencedButNotFound = totalReferencedFiles - (totalCacheFiles - orphanedFiles.length);
    if (referencedButNotFound > 0) {
      log('warn', `⚠️  有 ${referencedButNotFound} 个被引用的文件不在TDLight缓存中`);
      log('warn', `   可能这些文件已被删除或移动到其他位置`);
    }
  });
}

module.exports = clearOrphanedTdlightCache;