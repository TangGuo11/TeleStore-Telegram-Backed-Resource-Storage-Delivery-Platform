// game-api/file/GameFileClassifier.js
const GameLogger = require('./GameLogger');

class GameFileClassifier {
  constructor() {
    // 🎯 文件类型阈值配置
    this.thresholds = {
      SMALL_FILE: 20 * 1024 * 1024, // 20MB - 小文件阈值
    };

    // 🎯 文件类型映射
    this.fileTypeMap = {
      // 安装包类型
      INSTALLER: ['apk', 'ipa', 'exe', 'msi', 'dmg', 'pkg', 'deb', 'rpm'],
      // 图片类型
      IMAGE: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'],
      // 视频类型
      VIDEO: ['mp4', 'mov', 'avi', 'mkv', 'webm', 'flv'],
      // 文档类型
      DOCUMENT: ['pdf', 'txt', 'doc', 'docx', 'xls', 'xlsx'],
      // 压缩包类型
      ARCHIVE: ['zip', 'rar', '7z', 'tar', 'gz'],
    };

    GameLogger.cache('🎯 GameFileClassifier 初始化完成');
  }

  /*------------------ 主分类方法 --------------------*/
  classify(fileInfo) {
    const { type, file_size, file_path } = fileInfo || {};
    
    // 🎯 第一步：确定文件基础类型
    const baseType = this.determineBaseType(fileInfo);
    
    // 🎯 第二步：确定存储目录
    const storageDir = this.getStorageDir(baseType);
    
    // 🎯 第三步：确定处理策略
    const strategy = this.determineStrategy(baseType, file_size, file_path);
    
    // 🎯 第四步：确定是否需要缓存和软链接
    const cacheInfo = this.determineCacheInfo(strategy, baseType, file_size, file_path);
    
    const classification = {
      baseType,           // photo/video/document
      storageDir,         // yx/photo, yx/video, yx/documents
      strategy,           // direct/tdlight
      cacheInfo,          // { shouldCache, shouldCreateSymlink }
      file_size,
      file_path,
      hasFilePath: !!file_path,
      isLargeFile: file_size >= this.thresholds.SMALL_FILE,
      timestamp: Date.now()
    };

    GameLogger.cache(`📊 文件分类结果:`, classification);
    return classification;
  }

  /*------------------ 确定基础文件类型 --------------------*/
  determineBaseType(fileInfo) {
    const { type, mime_type, file_name } = fileInfo || {};
    
    // 🎯 新增：如果是缩略图请求，返回 'photo' 类型（与图片一起处理）
    if (type === 'thumbnail' || this.isThumbnailRequest(fileInfo)) {
      return 'photo'; // 缩略图当作图片处理
    }
    
    // 优先使用type字段
    if (type === 'photo') return 'photo';
    if (type === 'video') return 'video';
    if (type === 'document') {
      // 进一步细分文档类型
      return this.classifyDocumentType(mime_type, file_name);
    }
    
    // 通过MIME类型判断
    if (mime_type) {
      if (mime_type.startsWith('image/')) return 'photo';
      if (mime_type.startsWith('video/')) return 'video';
    }
    
    // 通过文件扩展名判断
    if (file_name) {
      const ext = this.getFileExtension(file_name).toLowerCase();
      if (this.fileTypeMap.IMAGE.includes(ext)) return 'photo';
      if (this.fileTypeMap.VIDEO.includes(ext)) return 'video';
      if (this.fileTypeMap.INSTALLER.includes(ext)) return 'document';
    }
    
    return 'document'; // 默认
  }


  /*------------------ 判断是否是缩略图请求 --------------------*/
  isThumbnailRequest(fileInfo) {
    // 通过上下文判断：如果是通过thumb_file_id查找的，就是缩略图
    // 这个判断逻辑会在GameFileController中实现
    return false; // 占位，实际在Controller中判断
  }


  /*------------------ 确定存储目录 --------------------*/
  getStorageDir(baseType) {
    const dirs = {
      'photo': 'photo',
      'video': 'video', 
      'document': 'documents'
    };
    return dirs[baseType] || 'documents';
  }

  /*------------------ 确定处理策略 --------------------*/
  determineStrategy(baseType, file_size, file_path) {
    // 🎯 图片永远直接下载
    if (baseType === 'photo') {
      return 'direct';
    }
    
    // 🎯 视频/文件：根据大小决定
    if (file_size && file_size >= this.thresholds.SMALL_FILE && file_path) {
      // 大文件且有file_path：使用TDLight
      return 'tdlight';
    }
    
    // 其他情况：直接下载
    return 'direct';
  }

  /*------------------ 确定缓存信息 --------------------*/
  determineCacheInfo(strategy, baseType, file_size, file_path) {
    // 🎯 默认值
    const cacheInfo = {
      shouldCache: false,
      shouldCreateSymlink: false,
      cacheType: 'none' // memory/disk/tdlight
    };
    
    // 图片：缓存到磁盘
    if (baseType === 'photo') {
      cacheInfo.shouldCache = true;
      cacheInfo.cacheType = 'disk';
    }
    
    // 小文件（直接下载）：缓存到磁盘
    if (strategy === 'direct' && file_size && file_size < this.thresholds.SMALL_FILE && file_path) {
      cacheInfo.shouldCache = true;
      cacheInfo.cacheType = 'disk';
    }
    
    // TDLight缓存：需要创建软链接
    if (strategy === 'tdlight') {
      cacheInfo.shouldCache = true;
      cacheInfo.shouldCreateSymlink = true;
      cacheInfo.cacheType = 'tdlight';
    }
    
    return cacheInfo;
  }

  /*------------------ 工具方法 --------------------*/
  classifyDocumentType(mime_type, file_name) {
    if (!mime_type && !file_name) return 'document';
    
    if (mime_type === 'application/vnd.android.package-archive') return 'document';
    if (file_name) {
      const ext = this.getFileExtension(file_name).toLowerCase();
      if (this.fileTypeMap.INSTALLER.includes(ext)) return 'document';
    }
    
    return 'document';
  }

  getFileExtension(filename) {
    if (!filename) return '';
    return filename.includes('.') 
      ? filename.split('.').pop().toLowerCase()
      : '';
  }
}

module.exports = GameFileClassifier;