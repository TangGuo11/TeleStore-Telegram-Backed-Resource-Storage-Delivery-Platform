// file/utils.js - 工具函数
const fs = require('fs');
const path = require('path');
const mime = require("mime-types");

/*------------------ 日志工具 --------------------*/
const logger = {
  file: (msg) => console.log(`[FILE] ${msg}`),
  cache: (msg) => console.log(`[CACHE] ${msg}`),
  tdlight: (msg) => console.log(`[TDLIGHT] ${msg}`),
  download: (msg) => console.log(`[DOWNLOAD] ${msg}`),
  error: (msg) => console.error(`[ERROR] ${msg}`),
  warn: (msg) => console.warn(`[WARN] ${msg}`),
  cleanup: (msg) => console.log(`[CLEANUP] ${msg}`)
};

/*------------------ 错误响应封装 --------------------*/
function respondError(res, msg, status = 500) {
  if (!res.headersSent) {
    res.status(status).send(msg);
  }
}

/*------------------ 安全发送文件（支持Range/软链接/视频流） --------------------*/
async function safeSendFile(a, b, c) {
  // 参数规范化
  let req, res, filePath;
  if (typeof a === 'object' && a && a.headers && b && c) {
    req = a;
    res = b;
    filePath = c;
  } else if (typeof a === 'object' && a && typeof a.send === 'function' && b) {
    res = a;
    filePath = b;
    req = res.req || {};
  } else {
    throw new Error('safeSendFile: invalid arguments');
  }

  return new Promise(async (resolve, reject) => {
    try {
      // 处理软链接，获取真实路径
      let realFilePath = filePath;
      try {
        if (await isSymlink(filePath)) {
          realFilePath = await getRealPath(filePath);
        }
      } catch (e) {
        logger.warn(`软链接解析失败: ${e.message}`);
      }

      // 检查文件是否存在
      if (!fs.existsSync(realFilePath)) {
        if (!res.headersSent) res.status(404).send("File not found");
        return reject(new Error(`File not found: ${realFilePath}`));
      }

      const stat = fs.statSync(realFilePath);
      const fileSize = stat.size;
      const rangeHeader = req.headers.range;
      
      // 设置MIME类型
      const ext = path.extname(realFilePath).toLowerCase();
      let mimeType = 'video/mp4';
      if (ext === '.webm') mimeType = 'video/webm';
      if (ext === '.avi') mimeType = 'video/x-msvideo';
      if (ext === '.mov') mimeType = 'video/quicktime';

      // 浏览器兼容性检测
      const userAgent = req.headers['user-agent'] || '';
      const needsCompatibility = /edg|trident|msie/i.test(userAgent);
      
      // 基础响应头
      const baseHeaders = {
        "Content-Type": mimeType,
        "Accept-Ranges": "bytes",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Expose-Headers": "Content-Range, Accept-Ranges"
      };

      // 浏览器特定处理
      if (needsCompatibility) {
        Object.assign(baseHeaders, {
          "Cache-Control": "no-cache, no-store, must-revalidate",
          "Pragma": "no-cache",
          "Expires": "0",
          "X-Content-Type-Options": "nosniff"
        });
      } else {
        Object.assign(baseHeaders, {
          "Cache-Control": "public, max-age=31536000"
        });
      }

      // 处理Range请求
      if (rangeHeader) {
        const parts = rangeHeader.replace(/bytes=/, "").split("-");
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
        const chunksize = (end - start) + 1;

        // 验证范围有效性
        if (start >= fileSize || end >= fileSize) {
          res.writeHead(416, {
            "Content-Range": `bytes */${fileSize}`
          });
          return res.end();
        }

        const headers = {
          ...baseHeaders,
          "Content-Range": `bytes ${start}-${end}/${fileSize}`,
          "Content-Length": chunksize
        };

        const statusCode = needsCompatibility ? 200 : 206;
        res.writeHead(statusCode, headers);
        
        const stream = fs.createReadStream(realFilePath, { 
          start, 
          end,
          highWaterMark: 64 * 1024
        });
        
        stream.on("error", reject);
        stream.on("end", resolve);
        stream.pipe(res);
        
      } else {
        // 发送完整文件
        const headers = {
          ...baseHeaders,
          "Content-Length": fileSize
        };

        res.writeHead(200, headers);
        const stream = fs.createReadStream(realFilePath, {
          highWaterMark: 64 * 1024
        });
        
        stream.on("error", reject);
        stream.on("end", resolve);
        stream.pipe(res);
      }

    } catch (err) {
      logger.error(`safeSendFile异常: ${err.message}`);
      if (!res.headersSent) res.status(500).send("文件发送失败");
      reject(err);
    }
  });
}

/*------------------ 文件类型目录映射 --------------------*/
function getFileTypeSubDir(fileType) {
  const typeMap = {
    'photo': 'photo',
    'thumbnail': 'photo',
    'thumb_file': 'photo',
    'video': 'video',
    'document': 'document'
  };
  return typeMap[fileType] || '';
}

/*------------------ 生成缓存文件路径（自动分层） --------------------*/
function getCacheFileName(fileId, uniqueId = 'cached', ext = '', dbName = 'telegramDB', fileType = '') {
  const { CACHE_DIR, DB_CACHE_MAP } = require('./config');
  
  const safeId = fileId.replace(/[^a-zA-Z0-9_-]/g, '_');
  const safeUniqueId = uniqueId.replace(/[^a-zA-Z0-9_-]/g, '_');

  // 第一级分类：数据库类型
  const category = DB_CACHE_MAP[dbName] || 'telegram';
  let targetDir = path.join(CACHE_DIR, category);

  // 第二级分类：文件类型子目录
  if (fileType) {
    const typeSubDir = getFileTypeSubDir(fileType);
    if (typeSubDir) {
      targetDir = path.join(targetDir, typeSubDir);
    }
  }

  // 确保目录存在
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  return path.join(targetDir, `${safeId}_${safeUniqueId}${ext}`);
}

/*------------------ 路径编码/解码 --------------------*/
function encodePath(p) {
  return p.split('/').map(segment => encodeURIComponent(segment)).join('/');
}

function decodePath(p) {
  return decodeURIComponent(p);
}

/*------------------ 软链接健康检查 --------------------*/
async function checkSymlinkHealth(symlinkPath) {
  try {
    // 检查软链接是否存在
    if (!await fileExists(symlinkPath)) {
      return { 
        exists: false, 
        isSymlink: false, 
        healthy: false,
        reason: '软链接不存在'
      };
    }

    const stats = await fs.promises.lstat(symlinkPath);
    const isSymlink = stats.isSymbolicLink();
    
    if (!isSymlink) {
      return { 
        exists: true, 
        isSymlink: false, 
        healthy: true,
        reason: '是真实文件，不是软链接'
      };
    }

    // 获取真实路径
    const realPath = await getRealPath(symlinkPath);
    const targetExists = await fileExists(realPath);
    
    if (!targetExists) {
      return {
        exists: true,
        isSymlink: true,
        healthy: false,
        reason: '悬挂链接：真实文件不存在',
        symlinkPath: symlinkPath,
        targetPath: realPath
      };
    }

    // 检查文件可读性
    try {
      await fs.promises.access(realPath, fs.constants.R_OK);
      return {
        exists: true,
        isSymlink: true,
        healthy: true,
        reason: '软链接健康',
        symlinkPath: symlinkPath,
        targetPath: realPath,
        targetSize: (await fs.promises.stat(realPath)).size
      };
    } catch (accessError) {
      return {
        exists: true,
        isSymlink: true,
        healthy: false,
        reason: '真实文件不可读',
        symlinkPath: symlinkPath,
        targetPath: realPath,
        error: accessError.message
      };
    }

  } catch (error) {
    return {
      exists: false,
      isSymlink: false,
      healthy: false,
      reason: '检查过程中出错',
      error: error.message
    };
  }
}

/*------------------ 修复悬挂的软链接 --------------------*/
async function repairSymlink(symlinkPath, newTargetPath = null) {
  try {
    const health = await checkSymlinkHealth(symlinkPath);
    
    if (health.healthy) {
      return { success: true, repaired: false, health };
    }

    // 删除有问题的软链接
    if (health.exists) {
      await fs.promises.unlink(symlinkPath);
    }

    // 重新创建软链接
    if (newTargetPath && await fileExists(newTargetPath)) {
      await createSymlinkToBusiness(newTargetPath, 
        path.basename(symlinkPath, path.extname(symlinkPath)),
        'repaired',
        'auto',
        path.extname(newTargetPath).replace('.', '')
      );
      return { success: true, repaired: true, health };
    }

    return { success: true, repaired: false, health };

  } catch (error) {
    logger.error(`修复软链接失败: ${error.message}`);
    return { success: false, repaired: false, error: error.message };
  }
}

/*------------------ 批量检查目录软链接健康 --------------------*/
async function checkSymlinksInDirectory(directory, recursive = false) {
  try {
    if (!await fileExists(directory)) {
      logger.warn(`目录不存在: ${directory}`);
      return [];
    }

    const results = [];
    const items = await fs.promises.readdir(directory);

    for (const item of items) {
      const fullPath = path.join(directory, item);
      const stats = await fs.promises.lstat(fullPath);

      if (stats.isSymbolicLink()) {
        const health = await checkSymlinkHealth(fullPath);
        results.push({
          name: item,
          path: fullPath,
          ...health
        });
      } else if (recursive && stats.isDirectory()) {
        const subResults = await checkSymlinksInDirectory(fullPath, true);
        results.push(...subResults);
      }
    }

    return results;
  } catch (error) {
    logger.error(`检查目录软链接失败: ${error.message}`);
    return [];
  }
}

/*------------------ 创建软链接到业务目录 --------------------*/
async function createSymlinkToBusiness(tdlightFilePath, fileId, uniqueId, dbName = 'telegramDB', fileType = '') {
  const cacheManager = require('./CacheManager'); // 需要获取cacheManager实例
  let cacheKey;
  try {
    // 生成缓存键（如果cacheManager可用）
    if (global.cacheManager) {
      cacheKey = global.cacheManager.getCacheKey(fileId, dbName, fileType);
      global.cacheManager.creatingSymlinks.add(cacheKey);
    }
    
    const businessPath = getCacheFileName(fileId, uniqueId, path.extname(tdlightFilePath), dbName, fileType);
    
    // 🆕 修复：直接使用传入的绝对路径，不再重新构造路径
    const realFilePath = tdlightFilePath; // 直接使用传入的路径
    
    // 检查文件是否存在
    if (!await fileExists(realFilePath)) {
      throw new Error(`文件不存在: ${realFilePath}`);
    }
    
    // 检查软链接健康状况
    const health = await checkSymlinkHealth(businessPath);
    
    if (health.exists) {
      if (health.healthy) {
        return businessPath;
      } else {
        await repairSymlink(businessPath, realFilePath);
        return businessPath;
      }
    }
    
    // 创建目录和软链接
    const businessDir = path.dirname(businessPath);
    await fs.promises.mkdir(businessDir, { recursive: true });
    
    // 🆕 修复：使用传入的绝对路径创建相对路径
    const relativePath = path.relative(businessDir, realFilePath);
    await fs.promises.symlink(relativePath, businessPath);
    
    logger.cache(`🔗 软链接创建成功: ${businessPath} -> ${realFilePath}`);
    
    return businessPath;
  } catch (error) {
    logger.error(`❌ 创建软链接失败: ${error.message}`);
    throw error;
  } finally {
    // 确保锁被释放
    if (global.cacheManager && cacheKey) {
      global.cacheManager.creatingSymlinks.delete(cacheKey);
    }
  }
}

/*------------------ 基础文件操作工具 --------------------*/
async function fileExists(filePath) {
  try {
    await fs.promises.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function isSymlink(filePath) {
  try {
    const stats = await fs.promises.lstat(filePath);
    return stats.isSymbolicLink();
  } catch {
    return false;
  }
}

async function getRealPath(filePath) {
  try {
    return await fs.promises.realpath(filePath);
  } catch {
    return filePath;
  }
}

/*------------------ 检查TDLight文件并创建软链接 --------------------*/
async function checkAndCreateTDLightSymlink(file, fileId, dbName = 'telegramDB', fileType = '') {
  const { BASE_CACHE_DIR, TDLIGHT_BOT_DIR } = require('./config');
  
  if (!file.file_path || file.file_path.trim() === '') {
    return { exists: false };
  }
  
  const tdlightFilePath = path.resolve(BASE_CACHE_DIR, TDLIGHT_BOT_DIR, file.file_path);
  const exists = await fileExists(tdlightFilePath);
  
  if (exists) {
    try {
      const businessPath = await createSymlinkToBusiness(
        tdlightFilePath,
        fileId,
        file.file_unique_id,
        dbName,
        fileType
      );
      
      return {
        exists: true,
        businessPath: businessPath,
        realPath: tdlightFilePath,
        isSymlink: true
      };
    } catch (error) {
      logger.error(`TDLight软链接创建失败: ${error.message}`);
      return {
        exists: true,
        businessPath: tdlightFilePath,
        realPath: tdlightFilePath,
        isSymlink: false,
        error: error.message
      };
    }
  }
  
  return { exists: false };
}

module.exports = {
  logger,
  respondError,
  safeSendFile,
  getCacheFileName,
  getFileTypeSubDir,
  encodePath,
  decodePath,
  // 软链接相关函数
  createSymlinkToBusiness,
  fileExists,
  isSymlink,
  getRealPath,
  checkAndCreateTDLightSymlink,
  // 软链接健康检查功能
  checkSymlinkHealth,
  repairSymlink,
  checkSymlinksInDirectory
};