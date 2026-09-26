// game-api/file/GameSymlinkManager.js - 软链接管理器 
const fs = require('fs');
const path = require('path');
const GameLogger = require('./GameLogger');
const GameConfig = require('./gameConfig');

class GameSymlinkManager {
  constructor(cacheManager) {
    this.cacheManager = cacheManager;
    this.config = GameConfig;
    
    // 🎯 记录正在创建的软链接
    this.creatingSymlinks = new Map();
    
    GameLogger.cache('🔗 GameSymlinkManager 初始化完成');
  }
  
  /*------------------ 创建软链接（核心方法） --------------------*/
  async createSymlink(fileId, fileInfo, tdlightFilePath) {
    const symlinkKey = `${fileId}_${fileInfo.file_path || 'no_path'}`;
    
    try {
      // 🎯 防止重复创建
      if (this.creatingSymlinks.has(symlinkKey)) {
        GameLogger.cache(`⏳ 软链接正在创建中: ${symlinkKey}`);
        const existing = this.creatingSymlinks.get(symlinkKey);
        return await existing.promise;
      }
      
      // 🎯 开始创建软链接
      const promise = this._createSymlinkInternal(fileId, fileInfo, tdlightFilePath);
      this.creatingSymlinks.set(symlinkKey, { promise, startTime: Date.now() });
      
      const result = await promise;
      
      // 🎯 清理记录
      this.creatingSymlinks.delete(symlinkKey);
      
      return result;
      
    } catch (error) {
      this.creatingSymlinks.delete(symlinkKey);
      throw error;
    }
  }
  

/*------------------ 内部创建软链接逻辑 --------------------*/
async _createSymlinkInternal(fileId, fileInfo, tdlightFilePath) {

  /*------------------ 1. 源文件检查 --------------------*/
  if (!fs.existsSync(tdlightFilePath)) {
    throw new Error(`❌ TDLight 缓存文件不存在: ${tdlightFilePath}`);
  }

  const symlinkPath = this.config.getSymlinkPath(fileId, fileInfo);
  const symlinkDir = path.dirname(symlinkPath);

  /*------------------ 2. 创建目录（如果不存在） --------------------*/
  if (!fs.existsSync(symlinkDir)) {
    fs.mkdirSync(symlinkDir, { recursive: true });
    GameLogger.cache(`📁 创建软链目录: ${symlinkDir}`);
  }

  /*------------------------------------------------------
   * 3. 新增：判断软链是否存在且健康
   *------------------------------------------------------*/
  let needRecreate = true;

  try {
    const stat = await fs.promises.lstat(symlinkPath);

    if (stat.isSymbolicLink()) {
      // 读取软链目标
      const target = await fs.promises.readlink(symlinkPath);
      const resolvedTargetPath = path.resolve(symlinkDir, target);

      if (fs.existsSync(resolvedTargetPath)) {
        // ✔️ 健康软链 → 无需重建
        GameLogger.cache(`👌 软链健康，无需重建: ${symlinkPath} -> ${target}`);

        const stats = fs.statSync(tdlightFilePath);

        this.cacheManager?.addToGameCache?.(
          fileId, symlinkPath, stats.size, true, tdlightFilePath
        );

        return {
          success: true,
          isSymlink: true,
          isNew: false,
          symlinkPath,
          realPath: tdlightFilePath,
          size: stats.size
        };
      } else {
        // ❌ 坏链，删除
        GameLogger.cache(`🗑️ 检测到坏链，删除: ${symlinkPath}`);
        await fs.promises.unlink(symlinkPath);
      }

    } else {
      // 不是软链（文件等）直接删除
      GameLogger.cache(`🗑️ 删除非软链文件: ${symlinkPath}`);
      await fs.promises.unlink(symlinkPath);
    }

  } catch (err) {
    if (err.code !== "ENOENT") {
      GameLogger.warn(`⚠️ 检查软链异常，将重新创建: ${symlinkPath}`, err);
    }
    // 文件不存在... 需要创建
  }

  /*------------------------------------------------------
   * 4. 创建新的软链（相对路径优先）
   *------------------------------------------------------*/

  const relative = path.relative(symlinkDir, tdlightFilePath);

  try {
    await fs.promises.symlink(relative, symlinkPath);

    const health = await this.checkSymlinkHealth(symlinkPath);
    if (!health.healthy) throw new Error("相对软链健康检查失败");

    const stats = fs.statSync(tdlightFilePath);

    this.cacheManager?.addToGameCache?.(
      fileId, symlinkPath, stats.size, true, tdlightFilePath
    );

    GameLogger.cache(`🔗 相对路径软链成功: ${symlinkPath} -> ${relative}`);

    return {
      success: true,
      isSymlink: true,
      isNew: true,
      relativePath: relative,
      symlinkPath,
      realPath: tdlightFilePath,
      size: stats.size
    };

  } catch (err) {
    GameLogger.warn(`❌ 相对软链失败，尝试绝对路径: ${symlinkPath}`, err.message);
  }

  /*------------------ 5. 尝试绝对路径软链 --------------------*/
  try {
    await fs.promises.symlink(tdlightFilePath, symlinkPath);

    const health = await this.checkSymlinkHealth(symlinkPath);
    if (!health.healthy) throw new Error("绝对路径软链健康检查失败");

    const stats = fs.statSync(tdlightFilePath);

    this.cacheManager?.addToGameCache?.(
      fileId, symlinkPath, stats.size, true, tdlightFilePath
    );

    GameLogger.cache(`🔗 绝对路径软链成功: ${symlinkPath}`);

    return {
      success: true,
      isSymlink: true,
      isNew: true,
      isAbsolute: true,
      symlinkPath,
      realPath: tdlightFilePath,
      size: stats.size
    };

  } catch (err) {

    GameLogger.error(`❌ 两种软链均失败: ${symlinkPath}`, err);

    // 清理遗留文件
    try { await fs.promises.unlink(symlinkPath); } catch (_) {}

    throw new Error(`无法创建软链接（相对+绝对均失败）: ${err.message}`);
  }
}

  /*------------------ 计算文件哈希（简单版） --------------------*/
  async getFileHash(filePath) {
    try {
      const stats = fs.statSync(filePath);
      
      // 使用文件大小和修改时间作为简单哈希
      // 对于大文件，完全哈希太耗时，这个简化版本足够
      return `${stats.size}_${stats.mtimeMs}`;
    } catch (error) {
      GameLogger.error(`❌ 计算文件哈希失败: ${filePath}`, error);
      return null;
    }
  }
  
  /*------------------ 检查软链接健康状况 --------------------*/
  async checkSymlinkHealth(symlinkPath) {
    try {
      if (!fs.existsSync(symlinkPath)) {
        return {
          exists: false,
          healthy: false,
          reason: '软链接不存在'
        };
      }
      
      const stats = fs.lstatSync(symlinkPath);
      if (!stats.isSymbolicLink()) {
        return {
          exists: true,
          healthy: false,
          reason: '不是软链接'
        };
      }
      
      // 🎯 获取真实路径
      const realPath = await fs.promises.realpath(symlinkPath);
      
      if (!fs.existsSync(realPath)) {
        return {
          exists: true,
          healthy: false,
          reason: '目标文件不存在',
          realPath
        };
      }
      
      // 🎯 检查目标文件可读性
      await fs.promises.access(realPath, fs.constants.R_OK);
      const targetStats = fs.statSync(realPath);
      
      return {
        exists: true,
        healthy: true,
        realPath,
        targetSize: targetStats.size,
        targetMtime: targetStats.mtime
      };
      
    } catch (error) {
      return {
        exists: false,
        healthy: false,
        reason: error.message,
        error: error.message
      };
    }
  }
  
  /*------------------ 智能创建或获取文件路径 --------------------*/
  async smartGetFilePath(fileId, fileInfo, tdlightFilePath) {
    try {
      // 1. 尝试创建软链接
      const symlinkResult = await this.createSymlink(fileId, fileInfo, tdlightFilePath);
      
      if (symlinkResult.success) {
        // 无论是软链接还是原文件，都返回可用的路径
        return {
          success: true,
          filePath: symlinkResult.symlinkPath,
          realPath: symlinkResult.realPath,
          isSymlink: symlinkResult.isSymlink || false,
          isOriginalFile: symlinkResult.isOriginalFile || false,
          details: symlinkResult
        };
      }
      
      // 2. 软链接失败，直接使用原文件
      if (fs.existsSync(tdlightFilePath)) {
        GameLogger.cache(`🔄 软链接失败，直接使用原文件: ${tdlightFilePath}`);
        return {
          success: true,
          filePath: tdlightFilePath,
          realPath: tdlightFilePath,
          isSymlink: false,
          isOriginalFile: true,
          fallback: true
        };
      }
      
      throw new Error(`无法获取可用的文件路径: ${tdlightFilePath}`);
      
    } catch (error) {
      GameLogger.error(`❌ 智能获取文件路径失败`, error);
      throw error;
    }
  }
  
  /*------------------ 修复软链接 --------------------*/
  async repairSymlink(symlinkPath, newTargetPath = null) {
    try {
      const health = await this.checkSymlinkHealth(symlinkPath);
      
      if (health.healthy) {
        return { 
          success: true, 
          repaired: false,
          health 
        };
      }
      
      // 🎯 删除有问题的软链接
      if (health.exists) {
        fs.unlinkSync(symlinkPath);
      }
      
      // 🎯 如果有新目标路径，重新创建
      if (newTargetPath && fs.existsSync(newTargetPath)) {
        const symlinkDir = path.dirname(symlinkPath);
        
        // 尝试相对路径
        try {
          const relativePath = path.relative(symlinkDir, newTargetPath);
          await fs.promises.symlink(relativePath, symlinkPath);
          
          return { 
            success: true, 
            repaired: true,
            isRelative: true,
            newTarget: newTargetPath 
          };
        } catch (relativeError) {
          // 相对路径失败，尝试绝对路径
          try {
            await fs.promises.symlink(newTargetPath, symlinkPath);
            
            return { 
              success: true, 
              repaired: true,
              isAbsolute: true,
              newTarget: newTargetPath 
            };
          } catch (absoluteError) {
            GameLogger.error(`❌ 修复软链接失败`, absoluteError);
            return { 
              success: false, 
              repaired: false,
              error: absoluteError.message 
            };
          }
        }
      }
      
      return { 
        success: false, 
        repaired: false,
        reason: '没有可用的目标文件' 
      };
      
    } catch (error) {
      GameLogger.error(`❌ 修复软链接失败: ${symlinkPath}`, error);
      return { 
        success: false, 
        repaired: false,
        error: error.message 
      };
    }
  }
  
  /*------------------ 批量修复软链接 --------------------*/
  async batchRepairSymlinks() {
    const fs = require('fs');
    const baseDir = this.config.GAME_STORAGE_DIR;
    const dirs = ['photo', 'video', 'documents'];
    
    let total = 0;
    let repaired = 0;
    let failed = 0;
    
    for (const dir of dirs) {
      const fullDir = path.join(baseDir, dir);
      
      if (!fs.existsSync(fullDir)) continue;
      
      try {
        const files = fs.readdirSync(fullDir);
        
        for (const file of files) {
          const filePath = path.join(fullDir, file);
          const stats = fs.lstatSync(filePath);
          
          if (stats.isSymbolicLink()) {
            total++;
            const health = await this.checkSymlinkHealth(filePath);
            
            if (!health.healthy) {
              GameLogger.warn(`⚠️ 发现不健康软链接: ${filePath}`, health);
              
              // 🎯 尝试修复
              if (health.realPath && fs.existsSync(health.realPath)) {
                const result = await this.repairSymlink(filePath, health.realPath);
                if (result.repaired) {
                  repaired++;
                  GameLogger.cache(`✅ 修复成功: ${filePath}`);
                } else {
                  failed++;
                }
              } else {
                // 🎯 找不到源文件，删除软链接
                fs.unlinkSync(filePath);
                GameLogger.cleanup(`🧹 删除悬空软链接: ${filePath}`);
              }
            }
          }
        }
      } catch (error) {
        GameLogger.error(`❌ 检查目录失败: ${fullDir}`, error);
      }
    }
    
    return {
      total,
      repaired,
      failed,
      healthy: total - (repaired + failed)
    };
  }
  
  /*------------------ 获取状态信息 --------------------*/
  getStatus() {
    return {
      creatingSymlinks: Array.from(this.creatingSymlinks.keys()),
      config: {
        gameStorageDir: this.config.GAME_STORAGE_DIR,
        tdlightBaseDir: this.config.TDLIGHT_BASE_DIR
      }
    };
  }
}

module.exports = GameSymlinkManager;