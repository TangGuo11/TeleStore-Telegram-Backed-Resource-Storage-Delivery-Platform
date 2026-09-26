//works/clearWorksCache.js-清理作品7天没有被访问过的缓存

const { safeExecute, getDirectorySize, formatFileSize, clearOldFilesRecursive } = require("./utils");

const path = require("path");
const WORKS_BASE_PATH = path.join(process.env.CACHE_DIR || path.join(process.cwd(), "downloads"), "works");
const CACHE_DIRS = ["video"]; // 目前只需要清理 video 目录
const MAX_AGE_DAYS = 7; // 7天未被访问

async function clearWorksCache() {
  await safeExecute("清理作品缓存", async () => {
    console.log(`🧹 [Works] 开始清理作品缓存目录: ${WORKS_BASE_PATH}`);
    console.log(`📅 [Works] 清理条件: ${MAX_AGE_DAYS} 天内未被访问的文件`);
    console.log(`⚠️ [Works] 注意: 系统 noatime 挂载可能影响访问时间准确性`);
    
    let totalDeleted = 0;
    let totalErrors = 0;
    let totalFreed = 0;
    let totalSymlinks = 0;
    let totalSkipped = 0;

    for (const dir of CACHE_DIRS) {
      const dirPath = `${WORKS_BASE_PATH}/${dir}`;
      console.log(`\n📁 [Works] 扫描目录: ${dir}`);
      
      // 计算清理前大小
      const sizeBefore = getDirectorySize(dirPath);
      console.log(`💾 [Works] 目录当前大小: ${formatFileSize(sizeBefore)}`);
      
      // 清理超过7天的文件
      const result = clearOldFilesRecursive(dirPath, MAX_AGE_DAYS);
      totalDeleted += result.deleted;
      totalErrors += result.errors;
      totalFreed += result.freed;
      totalSymlinks += result.symlinks;
      totalSkipped += result.skipped;
      
      // 计算清理后大小
      const sizeAfter = getDirectorySize(dirPath);
      
      console.log(`✅ [Works] ${dir} 清理结果:`);
      console.log(`  🗑️  删除 ${result.deleted} 个旧项目`);
      if (result.symlinks > 0) {
        console.log(`    └─ 包含 ${result.symlinks} 个符号链接`);
      }
      console.log(`  💾 释放 ${formatFileSize(result.freed)}`);
      console.log(`  📊 当前大小: ${formatFileSize(sizeAfter)}`);
      
      if (result.errors > 0) {
        console.log(`  ❌ ${result.errors} 个错误`);
      }
      if (result.skipped > 0) {
        console.log(`  ⏭️  ${result.skipped} 个项目被跳过（目录/特殊文件）`);
      }
    }

    console.log(`\n📊 [Works] 作品缓存清理总结:`);
    console.log(`  🗑️  总删除项目: ${totalDeleted} 个`);
    if (totalSymlinks > 0) {
      console.log(`    └─ 包含 ${totalSymlinks} 个符号链接`);
    }
    console.log(`  💾 总释放空间: ${formatFileSize(totalFreed)}`);
    
    if (totalErrors > 0) {
      console.log(`  ❌ 总错误数: ${totalErrors}`);
    }
    if (totalSkipped > 0) {
      console.log(`  ⏭️  总跳过项目: ${totalSkipped} 个`);
    }
    
    if (totalDeleted === 0) {
      console.log(`🎉 [Works] 没有需要清理的旧文件，所有文件都在 ${MAX_AGE_DAYS} 天内被访问过`);
    } else {
      console.log(`🎉 [Works] 作品缓存清理完成 - 保留了近期使用的文件`);
    }
    
    console.log(`🔧 [Works] 技术说明: 使用 mtime/ctime 作为备用时间判断，避免 noatime 影响`);
  });
}

module.exports = clearWorksCache;