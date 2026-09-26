// game-api/file/GameDownloadHandler.js - 游戏下载处理器
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { pipeline } = require('stream/promises');
const GameConfig = require('./gameConfig');
const GameLogger = require('./GameLogger');

class GameDownloadHandler {
  constructor(cacheManager) {
    this.cacheManager = cacheManager;
    this.config = GameConfig;
  }

  /*------------------ 主下载方法 --------------------*/
  async downloadFile(fileId, fileInfo, targetPath) {
    try {
      const { file_path, file_size, isThumbnail } = fileInfo;
      
      // 🎯 如果是缩略图，使用特殊的下载逻辑
      if (isThumbnail) {
        return await this.downloadThumbnailFile(fileId, fileInfo, targetPath);
      }
      
      // 🎯 修复：只有大文件且明确是TDLight路径时才检查TDLight缓存
      const shouldCheckTDLight = file_size && file_size > 20 * 1024 * 1024 && 
                                 file_path && this.isTDLightPath(file_path);
      
      if (shouldCheckTDLight) {
        GameLogger.download(`🔍 检查TDLight缓存: ${file_path}`);
        
        const tdlightPath = this.config.getTDLightCachePath(file_path);
        
        if (fs.existsSync(tdlightPath)) {
          GameLogger.download(`✅ 使用现有TDLight缓存: ${tdlightPath}`);
          
          // 复制文件到目标路径
          await this.copyFile(tdlightPath, targetPath);
          
          GameLogger.download(`📋 文件复制完成: ${targetPath}`);
          return targetPath;
        } else {
          // 🎯 小文件不应该抛出TDLIGHT_CACHE_MISSING错误
          // 而是应该直接下载
          GameLogger.download(`⚠️ TDLight缓存不存在，但这是小文件，直接下载: ${fileId}`);
        }
      }
      
      // 🎯 普通文件下载
      const fileUrl = await this.getFileUrl(fileInfo);
      
      GameLogger.download(`🚀 开始下载: ${fileId}`, {
        fileSize: file_size,
        hasTDLightPath: shouldCheckTDLight,
        url: fileUrl.substring(0, 100) + '...'
      });
      
      // 🎯 下载文件
      const response = await axios({
        method: 'GET',
        url: fileUrl,
        responseType: 'stream',
        timeout: this.getDownloadTimeout(file_size),
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; GameStoreBot/1.0)'
        }
      });
      
      // 🎯 创建写入流
      const writeStream = fs.createWriteStream(targetPath);
      
      // 🎯 管道传输
      await pipeline(response.data, writeStream);
      
      // 🎯 验证下载的文件
      await this.validateDownloadedFile(targetPath, file_size);
      
      GameLogger.download(`✅ 下载完成: ${fileId}`, {
        path: targetPath,
        size: file_size
      });
      
      return targetPath;
      
    } catch (error) {
      GameLogger.error(`❌ 下载失败: ${fileId}`, error);
      
      // 🎯 清理可能的部分下载文件
      if (fs.existsSync(targetPath)) {
        try {
          fs.unlinkSync(targetPath);
        } catch (cleanupError) {
          GameLogger.warn(`⚠️ 清理失败的文件失败: ${targetPath}`, cleanupError);
        }
      }
      
      throw error;
    }
  }

  /*------------------ 下载缩略图文件 --------------------*/
  async downloadThumbnailFile(fileId, fileInfo, targetPath) {
    try {
      GameLogger.download(`🖼️ 开始下载缩略图文件: ${fileId}`);
      
      // 通过Telegram API获取文件URL
      const fileUrl = await this.getFileUrlByFileId(fileId);
      
      // 下载缩略图
      const response = await axios({
        method: 'GET',
        url: fileUrl,
        responseType: 'stream',
        timeout: 30000, // 缩略图30秒超时
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; GameStoreBot/1.0)'
        }
      });
      
      // 创建写入流
      const writeStream = fs.createWriteStream(targetPath);
      
      // 管道传输
      await pipeline(response.data, writeStream);
      
      // 验证下载的文件
      await this.validateDownloadedFile(targetPath, fileInfo.file_size);
      
      GameLogger.download(`✅ 缩略图下载完成: ${fileId}`, {
        path: targetPath,
        size: fs.statSync(targetPath).size
      });
      
      return targetPath;
      
    } catch (error) {
      GameLogger.error(`❌ 缩略图下载失败: ${fileId}`, error);
      
      // 清理可能的部分下载文件
      if (fs.existsSync(targetPath)) {
        try {
          fs.unlinkSync(targetPath);
        } catch (cleanupError) {
          GameLogger.warn(`⚠️ 清理失败的缩略图文件失败: ${targetPath}`, cleanupError);
        }
      }
      
      throw error;
    }
  }

  /*------------------ 复制文件（用于TDLight缓存） --------------------*/
  async copyFile(sourcePath, targetPath) {
    return new Promise((resolve, reject) => {
      const readStream = fs.createReadStream(sourcePath);
      const writeStream = fs.createWriteStream(targetPath);
      
      readStream.on('error', reject);
      writeStream.on('error', reject);
      writeStream.on('finish', resolve);
      
      readStream.pipe(writeStream);
    });
  }

  /*------------------ 获取文件URL（优化版） --------------------*/
  async getFileUrl(fileInfo) {
    const { file_path, file_id, type, isThumbnail } = fileInfo;
    
    // 🎯 如果是缩略图，直接通过file_id获取URL
    if (isThumbnail) {
      return await this.getFileUrlByFileId(file_id);
    }
    
    // 🎯 情况1：有file_path（且不是TDLight路径）
    if (file_path && !this.isTDLightPath(file_path)) {
      return `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${file_path}`;
    }
    
    // 🎯 情况2：通过file_id获取
    // 如果file_path是TDLight路径，但小文件可以直接通过file_id下载
    return await this.getFileUrlByFileId(file_id);
  }
  
  /*------------------ 通过file_id获取文件URL --------------------*/
  async getFileUrlByFileId(fileId) {
    try {
      const response = await axios.get(
        `https://api.telegram.org/bot${process.env.BOT_TOKEN}/getFile`,
        { 
          params: { file_id: fileId },
          timeout: 15000
        }
      );
      
      if (response.data.ok) {
        const filePath = response.data.result.file_path;
        return `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${filePath}`;
      }
      
      throw new Error(`Telegram API返回错误: ${response.data.description}`);
      
    } catch (error) {
      GameLogger.error(`❌ 获取文件URL失败: ${fileId}`, error);
      throw error;
    }
  }
  
  /*------------------ 判断是否是TDLight路径 --------------------*/
  isTDLightPath(file_path) {
    // TDLight路径格式如: "videos/file_1.MP4", "documents/file_5.apk"
    return file_path && (
      file_path.startsWith('videos/') || 
      file_path.startsWith('documents/') || 
      file_path.startsWith('photos/')
    );
  }

  /*------------------ 获取下载超时时间 --------------------*/
  getDownloadTimeout(fileSize) {
    if (!fileSize || fileSize < 20 * 1024 * 1024) return 60000; // 1分钟
    return 300000; // 5分钟
  }
  
  /*------------------ 验证下载的文件 --------------------*/
  async validateDownloadedFile(filePath, expectedSize) {
    // 验证文件完整性
    if (!fs.existsSync(filePath)) {
      throw new Error('文件下载失败');
    }
    
    const stats = fs.statSync(filePath);
    if (expectedSize && expectedSize > 0 && stats.size !== expectedSize) {
      GameLogger.warn(`⚠️ 文件大小不匹配: ${filePath}`, {
        expected: expectedSize,
        actual: stats.size
      });
    }
    
    // 特别检查缩略图：确保不是空文件
    if (stats.size === 0) {
      throw new Error('下载的文件大小为0，可能下载失败');
    }
    
    return true;
  }
}

module.exports = GameDownloadHandler;