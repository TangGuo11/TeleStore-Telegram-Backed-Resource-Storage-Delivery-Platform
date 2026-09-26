// game-api/file/gameConfig.js
const path = require('path');
require('dotenv').config();

const GameFileClassifier = require('./GameFileClassifier');

class GameConfig {
  constructor() {
    this.fileClassifier = new GameFileClassifier();
    
    // 🎯 主存储目录
    this.GAME_STORAGE_DIR = process.env.GAME_STORAGE_DIR || path.join(process.cwd(), 'downloads', 'yx');
    
    // TDLight cache directory
    this.TDLIGHT_BASE_DIR = process.env.TDLIGHT_BASE_DIR || path.join(process.cwd(), 'downloads', 'tdlight');
    
    this.ensureDirectories();
  }
  
  /*------------------ 确保目录存在 --------------------*/
  ensureDirectories() {
    const fs = require('fs');
    
    // 🎯 yx目录结构
    const yxDirs = [
      path.join(this.GAME_STORAGE_DIR, 'photo'),
      path.join(this.GAME_STORAGE_DIR, 'video'),
      path.join(this.GAME_STORAGE_DIR, 'documents')
    ];
    
    // 🎯 TDLight目录结构
    const tdlightDirs = [
      path.join(this.TDLIGHT_BASE_DIR, 'photos'),
      path.join(this.TDLIGHT_BASE_DIR, 'videos'),
      path.join(this.TDLIGHT_BASE_DIR, 'documents')
    ];
    
    // 创建所有目录
    [...yxDirs, ...tdlightDirs].forEach(dir => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    });
  }
  
  /*------------------ 获取文件存储路径 --------------------*/
  getFilePath(fileId, fileInfo) {
    const classification = this.fileClassifier.classify(fileInfo);
    const { baseType, storageDir } = classification;
    
    // 🎯 生成文件名
    const fileName = this.generateFileName(fileId, fileInfo, baseType);
    
    return path.join(this.GAME_STORAGE_DIR, storageDir, fileName);
  }
  
  /*------------------ 生成文件名 --------------------*/
  generateFileName(fileId, fileInfo, baseType) {
    const { file_name, file_unique_id } = fileInfo || {};
    
    // 🎯 优先使用原始文件名
    if (file_name && file_name.trim() !== '') {
      return this.sanitizeFileName(file_name);
    }
    
    // 🎯 使用file_unique_id生成文件名
    if (file_unique_id) {
      const ext = this.getFileExtensionByType(baseType);
      return `${file_unique_id}${ext}`;
    }
    
    // 🎯 最后使用file_id
    const ext = this.getFileExtensionByType(baseType);
    return `${fileId.replace(/[^a-zA-Z0-9_-]/g, '_')}${ext}`;
  }
  
  /*------------------ 清理文件名 --------------------*/
  sanitizeFileName(fileName) {
    // 移除非法字符
    return fileName.replace(/[<>:"/\\|?*]/g, '_');
  }
  
  /*------------------ 根据类型获取扩展名 --------------------*/
  getFileExtensionByType(baseType) {
    const typeToExt = {
      'photo': '.jpg',
      'video': '.mp4',
      'document': '.bin'
    };
    
    return typeToExt[baseType] || '.bin';
  }
  
  /*------------------ 获取TDLight缓存路径 --------------------*/
  getTDLightCachePath(file_path) {
    if (!file_path) return null;
    
    // file_path格式如: "videos/file_1.MP4"
    // 直接拼接到TDLight目录
    return path.join(this.TDLIGHT_BASE_DIR, file_path);
  }
  
  /*------------------ 获取软链接路径 --------------------*/
  getSymlinkPath(fileId, fileInfo) {
    const classification = this.fileClassifier.classify(fileInfo);
    const { baseType, storageDir } = classification;
    
    // 🎯 生成软链接文件名
    const fileName = this.generateFileName(fileId, fileInfo, baseType);
    
    return path.join(this.GAME_STORAGE_DIR, storageDir, fileName);
  }
  
  /*------------------ 配置摘要 --------------------*/
  getConfigSummary() {
    return {
      gameStorageDir: this.GAME_STORAGE_DIR,
      tdlightBaseDir: this.TDLIGHT_BASE_DIR,
      thresholds: this.fileClassifier.thresholds
    };
  }
}

// 导出单例实例
module.exports = new GameConfig();