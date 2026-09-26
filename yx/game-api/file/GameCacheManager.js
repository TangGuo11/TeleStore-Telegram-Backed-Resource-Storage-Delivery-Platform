// game-api/file/GameCacheManager.js-游戏专用缓存管理
const fs = require('fs');
const path = require('path');
const GameConfig = require('./gameConfig');
const GameLogger = require('./GameLogger');
const GameSymlinkManager = require('./GameSymlinkManager');

class GameCacheManager {
  constructor() {
    this.config = GameConfig;
    
    // 🎯 缓存索引
    this.cacheIndex = new Map(); // fileId -> { path, size, type, isSymlink, realPath, lastAccess, accessCount }
    
    // 🎯 下载锁和软链接锁
    this.downloadLocks = new Set();
    this.symlinkManager = new GameSymlinkManager(this);
    
    // 🎯 清理任务
    this.startCleanupTasks();
    
    GameLogger.cache('🎮 GameCacheManager 初始化完成', this.getCacheStats());
  }
  
  /*------------------ 检查缓存（核心方法） --------------------*/
  async checkGameCache(fileId) {
    const cacheKey = `file_${fileId}`;
    
    // 🎯 1. 检查内存索引
    if (this.cacheIndex.has(cacheKey)) {
      const entry = this.cacheIndex.get(cacheKey);
      
      if (entry.path && fs.existsSync(entry.path)) {
        // 🎯 检查文件可访问性
        try {
          await fs.promises.access(entry.path, fs.constants.R_OK);
          
          // 🎯 如果是软链接，检查健康状态
          if (entry.isSymlink) {
            const health = await this.symlinkManager.checkSymlinkHealth(entry.path);
            if (health.healthy) {
              this.updateAccessStats(entry);
              
              GameLogger.cache(`💾 缓存命中（软链接）: ${fileId}`, {
                path: entry.path,
                size: entry.size,
                realPath: entry.realPath
              });
              
              return {
                hit: true,
                path: entry.path,
                size: entry.size,
                isSymlink: true,
                realPath: entry.realPath
              };
            } else {
              // 软链接不健康，删除索引
              GameLogger.cache(`⚠️ 软链接不健康，移除: ${fileId}`);
              this.cacheIndex.delete(cacheKey);
            }
          } else {
            // 普通文件，直接使用
            this.updateAccessStats(entry);
            
            GameLogger.cache(`💾 缓存命中（普通文件）: ${fileId}`, {
              path: entry.path,
              size: entry.size
            });
            
            return {
              hit: true,
              path: entry.path,
              size: entry.size,
              isSymlink: false
            };
          }
        } catch (accessError) {
          // 文件不可访问，删除索引
          GameLogger.cache(`⚠️ 缓存文件不可访问，移除: ${fileId}`);
          this.cacheIndex.delete(cacheKey);
        }
      } else {
        // 文件不存在，删除索引
        this.cacheIndex.delete(cacheKey);
      }
    }
    
    // 🎯 2. 检查磁盘文件（扫描对应目录）
    const diskCache = await this.checkDiskCache(fileId);
    if (diskCache.hit) {
      return diskCache;
    }
    
    return { hit: false };
  }
  
  /*------------------ 检查磁盘缓存 --------------------*/
  async checkDiskCache(fileId) {
    try {
      // 🎯 在所有存储目录中搜索（包括缩略图）
      const baseDir = this.config.GAME_STORAGE_DIR;
      const searchDirs = [
        path.join(baseDir, 'photo'),      // 普通图片和缩略图
        path.join(baseDir, 'video'),
        path.join(baseDir, 'documents')
      ];
      
      for (const searchDir of searchDirs) {
        if (!fs.existsSync(searchDir)) continue;
        
        const files = fs.readdirSync(searchDir);
        for (const file of files) {
          // 🎯 改进的文件名匹配逻辑，支持缩略图
          if (this.isFileMatch(file, fileId)) {
            const filePath = path.join(searchDir, file);
            
            try {
              const stats = fs.lstatSync(filePath);
              const isSymlink = stats.isSymbolicLink();
              
              let realPath = filePath;
              let actualSize = stats.size;
              
              if (isSymlink) {
                try {
                  realPath = await fs.promises.realpath(filePath);
                  const targetStats = fs.statSync(realPath);
                  actualSize = targetStats.size;
                } catch (error) {
                  // 软链接无法解析，跳过
                  continue;
                }
              }
              
              // 🎯 添加到缓存索引
              this.addToGameCache(
                fileId,
                filePath,
                actualSize,
                isSymlink,
                isSymlink ? realPath : null
              );
              
              GameLogger.cache(`💾 磁盘缓存发现: ${fileId}`, {
                path: filePath,
                size: actualSize,
                isSymlink,
                fileName: file
              });
              
              return {
                hit: true,
                path: filePath,
                size: actualSize,
                isSymlink,
                realPath: isSymlink ? realPath : filePath
              };
              
            } catch (error) {
              GameLogger.error(`❌ 检查文件失败: ${filePath}`, error);
            }
          }
        }
      }
    } catch (error) {
      GameLogger.error(`❌ 扫描磁盘缓存失败: ${fileId}`, error);
    }
    
    return { hit: false };
  }
  
  /*------------------ 检查文件是否匹配（增强版） --------------------*/
  isFileMatch(fileName, fileId) {
    // 清理fileId中的特殊字符
    const safeId = fileId.replace(/[^a-zA-Z0-9_-]/g, '_');
    
    // 🎯 情况1：文件名就是fileId（例如缩略图可能是thumb_XXX.jpg，但缓存的key是fileId）
    if (fileName === fileId || fileName === safeId) {
      return true;
    }
    
    // 🎯 情况2：文件名包含fileId的前面部分（Telegram file_id通常很长）
    if (fileId.length > 10 && fileName.includes(fileId.substring(0, 10))) {
      return true;
    }
    
    // 🎯 情况3：文件名包含safeId
    if (fileName.includes(safeId)) {
      return true;
    }
    
    // 🎯 情况4：对于缩略图，文件名可能是thumb_{file_unique_id}.jpg
    // 但我们在缓存时用的是thumb_file_id，所以需要特殊处理
    const fileNameWithoutExt = path.basename(fileName, path.extname(fileName));
    
    // 如果是thumb_开头的文件，可能是缩略图
    if (fileNameWithoutExt.startsWith('thumb_')) {
      // 提取file_unique_id部分
      const thumbUniqueId = fileNameWithoutExt.replace('thumb_', '');
      
      // 这里需要一个方法来查找fileId对应的file_unique_id
      // 但由于这是磁盘扫描，我们只能做简单的匹配
      // 实际匹配会在上层逻辑中处理
      return false; // 暂时返回false，避免误匹配
    }
    
    return false;
  }
  
  /*------------------ 添加到缓存（核心方法） --------------------*/
  addToGameCache(fileId, filePath, fileSize = 0, isSymlink = false, realPath = null) {
    const cacheKey = `file_${fileId}`;
    const now = Date.now();
    
    const entry = {
      path: filePath,
      size: fileSize,
      isSymlink,
      realPath,
      type: this.getFileType(filePath),
      lastAccess: now,
      accessCount: 1,
      createdTime: now,
      fileId
    };
    
    this.cacheIndex.set(cacheKey, entry);
    
    GameLogger.cache(`📝 缓存添加: ${fileId}`, {
      path: filePath,
      size: `${(fileSize / 1024 / 1024).toFixed(2)}MB`,
      isSymlink,
      cacheSize: this.cacheIndex.size,
      type: entry.type
    });
    
    return entry;
  }
  
  /*------------------ 获取文件类型（增强版，支持缩略图识别） --------------------*/
  getFileType(filePath) {
    const fileName = path.basename(filePath).toLowerCase();
    const ext = path.extname(filePath).toLowerCase();
    
    // 🎯 首先检查文件名是否是缩略图
    if (fileName.startsWith('thumb_')) {
      return 'photo'; // 缩略图归类为photo类型
    }
    
    // 🎯 根据扩展名判断
    if (['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp'].includes(ext)) {
      return 'photo';
    }
    
    if (['.mp4', '.mov', '.avi', '.mkv', '.webm', '.flv', '.wmv'].includes(ext)) {
      return 'video';
    }
    
    if (['.apk', '.ipa', '.exe', '.dmg', '.pkg', '.deb', '.rpm', '.msi'].includes(ext)) {
      return 'document';
    }
    
    if (['.zip', '.rar', '.7z', '.tar', '.gz', '.bz2'].includes(ext)) {
      return 'archive';
    }
    
    if (['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt'].includes(ext)) {
      return 'document';
    }
    
    return 'unknown';
  }
  
  /*------------------ 专门为缩略图添加缓存 --------------------*/
  addThumbnailToCache(thumbFileId, fileUniqueId, thumbnailPath) {
    try {
      if (!fs.existsSync(thumbnailPath)) {
        GameLogger.error(`❌ 缩略图文件不存在: ${thumbnailPath}`);
        return null;
      }
      
      const stats = fs.statSync(thumbnailPath);
      const entry = this.addToGameCache(
        thumbFileId,
        thumbnailPath,
        stats.size,
        false, // 缩略图不是软链接
        null
      );
      
      // 🎯 额外记录：建立file_unique_id到缩略图路径的映射
      // 这有助于后续的查询
      const uniqueKey = `thumb_by_unique_${fileUniqueId}`;
      this.cacheIndex.set(uniqueKey, {
        ...entry,
        isMapping: true,
        originalFileUniqueId: fileUniqueId,
        thumbnailFileId: thumbFileId
      });
      
      GameLogger.cache(`🎯 缩略图缓存添加: ${thumbFileId} -> ${fileUniqueId}`, {
        path: thumbnailPath,
        size: stats.size,
        fileUniqueId
      });
      
      return entry;
      
    } catch (error) {
      GameLogger.error(`❌ 添加缩略图缓存失败: ${thumbFileId}`, error);
      return null;
    }
  }
  
  /*------------------ 通过file_unique_id查找缩略图 --------------------*/
  async findThumbnailByUniqueId(fileUniqueId) {
    const mappingKey = `thumb_by_unique_${fileUniqueId}`;
    
    if (this.cacheIndex.has(mappingKey)) {
      const mapping = this.cacheIndex.get(mappingKey);
      const thumbFileId = mapping.thumbnailFileId;
      
      if (thumbFileId && this.cacheIndex.has(`file_${thumbFileId}`)) {
        const thumbEntry = this.cacheIndex.get(`file_${thumbFileId}`);
        
        if (thumbEntry.path && fs.existsSync(thumbEntry.path)) {
          try {
            await fs.promises.access(thumbEntry.path, fs.constants.R_OK);
            this.updateAccessStats(thumbEntry);
            
            return {
              found: true,
              thumbFileId,
              path: thumbEntry.path,
              size: thumbEntry.size
            };
          } catch (error) {
            // 文件不可访问，清理缓存
            this.cacheIndex.delete(`file_${thumbFileId}`);
            this.cacheIndex.delete(mappingKey);
          }
        }
      }
    }
    
    // 🎯 扫描磁盘查找缩略图
    const baseDir = this.config.GAME_STORAGE_DIR;
    const photoDir = path.join(baseDir, 'photo');
    
    if (fs.existsSync(photoDir)) {
      const expectedFileName = `thumb_${fileUniqueId}.jpg`;
      const expectedPath = path.join(photoDir, expectedFileName);
      
      if (fs.existsSync(expectedPath)) {
        const stats = fs.statSync(expectedPath);
        
        // 这里不知道thumb_file_id，所以无法添加到标准缓存
        // 但可以返回找到的文件
        return {
          found: true,
          path: expectedPath,
          size: stats.size,
          fileName: expectedFileName
        };
      }
    }
    
    return { found: false };
  }
  
  /*------------------ 更新访问统计 --------------------*/
  updateAccessStats(entry) {
    entry.lastAccess = Date.now();
    entry.accessCount = (entry.accessCount || 0) + 1;
  }
  
  /*------------------ 下载锁管理 --------------------*/
  acquireDownloadLock(fileId) {
    if (this.downloadLocks.has(fileId)) {
      return false;
    }
    
    this.downloadLocks.add(fileId);
    
    // 🎯 30秒后自动释放锁（缩略图下载更快，但使用相同锁）
    setTimeout(() => {
      this.downloadLocks.delete(fileId);
    }, 30000);
    
    return true;
  }
  
  releaseDownloadLock(fileId) {
    this.downloadLocks.delete(fileId);
  }
  
  /*------------------ 启动清理任务 --------------------*/
  startCleanupTasks() {
    // 🎯 每小时清理一次旧缓存
    setInterval(() => {
      this.cleanupOldCache();
    }, 60 * 60 * 1000);
    
    // 🎯 每天修复一次软链接
    setInterval(() => {
      this.symlinkManager.batchRepairSymlinks();
    }, 24 * 60 * 60 * 1000);
    
    // 🎯 每12小时清理无效的映射缓存
    setInterval(() => {
      this.cleanupInvalidMappings();
    }, 12 * 60 * 60 * 1000);
  }
  
  /*------------------ 清理旧缓存 --------------------*/
  cleanupOldCache() {
    const now = Date.now();
    const maxAge = 7 * 24 * 60 * 60 * 1000; // 7天
    const thumbnailMaxAge = 30 * 24 * 60 * 60 * 1000; // 缩略图保留30天
    let cleaned = 0;
    let thumbnailsCleaned = 0;
    
    for (const [cacheKey, entry] of this.cacheIndex.entries()) {
      // 🎯 跳过映射条目
      if (entry.isMapping) continue;
      
      const age = now - entry.lastAccess;
      const isThumbnail = entry.type === 'photo' && 
                         entry.path && 
                         path.basename(entry.path).startsWith('thumb_');
      
      let shouldClean = false;
      
      if (isThumbnail) {
        // 缩略图：30天未访问
        shouldClean = age > thumbnailMaxAge;
      } else {
        // 普通文件：7天未访问
        shouldClean = age > maxAge;
      }
      
      if (shouldClean) {
        try {
          // 🎯 如果是软链接，只删除软链接
          if (entry.isSymlink && entry.path) {
            if (fs.existsSync(entry.path)) {
              fs.unlinkSync(entry.path);
            }
          } else if (entry.path && fs.existsSync(entry.path)) {
            // 普通文件，删除文件
            fs.unlinkSync(entry.path);
          }
          
          cleaned++;
          if (isThumbnail) thumbnailsCleaned++;
          this.cacheIndex.delete(cacheKey);
          
        } catch (error) {
          GameLogger.error(`❌ 清理缓存失败: ${entry.path}`, error);
        }
      }
    }
    
    if (cleaned > 0) {
      GameLogger.cleanup(`🧹 缓存清理完成: 移除了 ${cleaned} 个条目（其中缩略图: ${thumbnailsCleaned}）`);
    }
  }
  
  /*------------------ 清理无效的映射缓存 --------------------*/
  cleanupInvalidMappings() {
    let cleanedMappings = 0;
    
    for (const [cacheKey, entry] of this.cacheIndex.entries()) {
      if (entry.isMapping) {
        const thumbFileId = entry.thumbnailFileId;
        const thumbCacheKey = `file_${thumbFileId}`;
        
        // 🎯 检查对应的缩略图缓存是否存在
        if (!this.cacheIndex.has(thumbCacheKey)) {
          this.cacheIndex.delete(cacheKey);
          cleanedMappings++;
        } else {
          const thumbEntry = this.cacheIndex.get(thumbCacheKey);
          // 🎯 检查文件是否存在
          if (!thumbEntry.path || !fs.existsSync(thumbEntry.path)) {
            this.cacheIndex.delete(cacheKey);
            this.cacheIndex.delete(thumbCacheKey);
            cleanedMappings++;
          }
        }
      }
    }
    
    if (cleanedMappings > 0) {
      GameLogger.cleanup(`🧹 清理无效映射: ${cleanedMappings} 个`);
    }
  }
  
  /*------------------ 获取缓存统计 --------------------*/
  getCacheStats() {
    let totalSize = 0;
    let symlinkCount = 0;
    let photoCount = 0;
    let videoCount = 0;
    let documentCount = 0;
    let thumbnailCount = 0;
    let mappingCount = 0;
    
    for (const entry of this.cacheIndex.values()) {
      if (entry.isMapping) {
        mappingCount++;
        continue;
      }
      
      totalSize += entry.size || 0;
      
      if (entry.isSymlink) symlinkCount++;
      
      // 🎯 区分普通图片和缩略图
      if (entry.type === 'photo') {
        const isThumbnail = entry.path && 
                           path.basename(entry.path).startsWith('thumb_');
        if (isThumbnail) {
          thumbnailCount++;
        } else {
          photoCount++;
        }
      } else if (entry.type === 'video') {
        videoCount++;
      } else if (entry.type === 'document') {
        documentCount++;
      }
    }
    
    return {
      totalEntries: this.cacheIndex.size,
      symlinkCount,
      mappingCount,
      totalSize: `${(totalSize / 1024 / 1024).toFixed(2)} MB`,
      byType: {
        photo: photoCount,
        thumbnail: thumbnailCount,
        video: videoCount,
        document: documentCount,
        archive: this.cacheIndex.size - photoCount - thumbnailCount - videoCount - documentCount - mappingCount - symlinkCount
      },
      activeDownloadLocks: this.downloadLocks.size,
      cacheHitRate: this.calculateHitRate()
    };
  }
  
  /*------------------ 计算命中率 --------------------*/
  calculateHitRate() {
    // 这里可以添加更复杂的命中率计算
    return 'N/A';
  }
  
  /*------------------ 清理所有缓存 --------------------*/
  async clearAllCache() {
    const statsBefore = this.getCacheStats();
    
    // 🎯 清理内存索引
    this.cacheIndex.clear();
    
    // 🎯 清理文件系统中的缓存文件
    const baseDir = this.config.GAME_STORAGE_DIR;
    const dirs = ['photo', 'video', 'documents'];
    
    for (const dir of dirs) {
      const fullDir = path.join(baseDir, dir);
      if (fs.existsSync(fullDir)) {
        try {
          const files = fs.readdirSync(fullDir);
          let deleted = 0;
          for (const file of files) {
            const filePath = path.join(fullDir, file);
            try {
              fs.unlinkSync(filePath);
              deleted++;
            } catch (error) {
              GameLogger.warn(`⚠️ 删除文件失败: ${filePath}`, error);
            }
          }
          GameLogger.cleanup(`🧹 清理目录 ${dir}: 删除了 ${deleted} 个文件`);
        } catch (error) {
          GameLogger.error(`❌ 清理目录失败: ${fullDir}`, error);
        }
      }
    }
    
    const statsAfter = this.getCacheStats();
    
    return {
      success: true,
      cleaned: statsBefore.totalEntries,
      before: statsBefore,
      after: statsAfter
    };
  }
}

module.exports = GameCacheManager;