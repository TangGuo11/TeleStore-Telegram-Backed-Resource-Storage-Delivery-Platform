// middlewares/fileOptimizerMiddleware.js
// 智能限速 + 并发合并 + 分布式锁 + fileController 联动 + range + proxy fallback
const fs = require('fs');
const path = require('path');
const { pipeline, Transform } = require('stream');
const { promisify } = require('util');
const pipelineAsync = promisify(pipeline);

let Redis = null;
let Redlock = null;
try {
  Redis = require('ioredis');
  Redlock = require('redlock');
} catch (e) {
  // 没装依赖也没事，代码会退回到进-process lock
}

const utils = (() => {
  // 尝试复用项目的工具（如果存在）
  try { return require('../file/utils'); } catch (e) { return null; }
})();

// ---- 内存队列与锁（用于多实例不可用时的本地 fallback） ----
const downloadQueue = new Map(); // fileId -> Promise that resolves when file ready
const inProcessLocks = new Set(); // fileId set as locked in-process

// ---- Redis/Redlock 初始化（可选） ----
let redisClient = null;
let redlock = null;
if (Redis && process.env.REDIS_URL) {
  redisClient = new Redis(process.env.REDIS_URL);
  if (Redlock) {
    redlock = new Redlock([redisClient], {
      retryCount: 3,
      retryDelay: 200,
      driftFactor: 0.01
    });
  }
}

// ---- 智能限速器工厂 ----
function smartLimitTransform(sizeBytes) {
  const MB = 1024 * 1024;
  let limit = Infinity;
  if (sizeBytes < 10 * MB) limit = Infinity;
  else if (sizeBytes < 50 * MB) limit = 10 * MB;
  else if (sizeBytes < 300 * MB) limit = 7 * MB;
  else limit = 5 * MB;

  if (!isFinite(limit)) return new Transform({
    transform(chunk, enc, cb) { cb(null, chunk); }
  });

  // token-bucket like simple limiter
  let tokens = limit;
  let last = Date.now();
  return new Transform({
    transform(chunk, enc, cb) {
      const now = Date.now();
      const delta = (now - last) / 1000;
      last = now;
      tokens += delta * limit;
      if (tokens > limit) tokens = limit;
      const trySend = () => {
        if (chunk.length <= tokens) {
          tokens -= chunk.length;
          cb(null, chunk);
        } else {
          // wait a bit
          setTimeout(trySend, 50);
        }
      };
      trySend();
    }
  });
}

// ---- 小工具：本地缓存路径（优先复用项目 utils.getCacheFileName） ----
function getLocalCachePath(fileId, uniqueId = 'cached', ext = '') {
  if (utils && typeof utils.getCacheFileName === 'function') {
    try { return utils.getCacheFileName(fileId, uniqueId, ext); } catch (e) { /* fallback */ }
  }
  // fallback to /tmp/zy_cache
  const safe = fileId.replace(/[^a-zA-Z0-9._-]/g, '_');
  const dir = path.join(process.cwd(), 'tmp_file_cache');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${safe}_${uniqueId}${ext}`);
}

// ---- 获得 fileController 元数据接口（改进版） ----
async function askFileController(app, fileId) {
  const fc = app && app.locals && app.locals.fileController;
  if (!fc) {
    console.log('[optimizer] fileController not found');
    return null;
  }
  
  console.log(`[optimizer] 获取文件元数据: ${fileId}`);
  
  let meta = null;
  let lastError = null;
  
  // 🎯 改进：尝试所有可能的方法名，带详细错误信息
  const methodNames = ['getFileMeta', 'getFileRoute', 'getMeta'];
  
  for (const methodName of methodNames) {
    if (typeof fc[methodName] === 'function') {
      try { 
        console.log(`[optimizer] 尝试方法: ${methodName}`);
        meta = await fc[methodName](fileId);
        if (meta) {
          console.log(`[optimizer] 通过 ${methodName} 获取元数据成功`);
          break;
        } else {
          console.log(`[optimizer] ${methodName} 返回 null`);
        }
      } catch (e) { 
        lastError = e;
        console.log(`[optimizer] ${methodName} 失败:`, e.message);
        // 🎯 添加堆栈信息以便调试
        if (e.stack) {
          console.log(`[optimizer] ${methodName} 错误堆栈:`, e.stack.split('\n').slice(0, 3).join('\n'));
        }
      }
    } else {
      console.log(`[optimizer] ${methodName} 方法不存在`);
    }
  }

  if (meta) {
    console.log(`[optimizer] 元数据获取成功:`, {
      source: meta.source,
      size: meta.size,
      ext: meta.ext,
      hasPath: !!meta.path,
      fileType: meta.fileType
    });
    
    // 🎯 改进：确保元数据格式正确
    if (!meta.source) {
      console.log(`[optimizer] 警告: 元数据缺少 source 字段，尝试推断`);
      if (meta.fileType === 'photo' || meta.fileType === 'video') {
        meta.source = 'telegram';
      } else if (meta.path && meta.path.startsWith('http')) {
        meta.source = 'proxy';
      } else if (meta.path && fs.existsSync(meta.path)) {
        meta.source = 'local';
      } else {
        meta.source = 'telegram'; // 默认
      }
      console.log(`[optimizer] 推断 source 为: ${meta.source}`);
    }
  } else {
    console.log(`[optimizer] 无法获取文件元数据，最后错误:`, lastError ? lastError.message : '未知');
    
    // 🎯 新增：尝试直接查询数据库获取基本信息
    try {
      console.log(`[optimizer] 尝试直接查询文件信息...`);
      if (fc.db && typeof fc.db.findFileById === 'function') {
        const fileResult = await fc.db.findFileById(fileId);
        if (fileResult && fileResult.doc) {
          const fileDoc = fileResult.doc;
          console.log(`[optimizer] 直接查询到文件文档，类型: ${fileDoc.file_type}`);
          
          // 构建基本元数据
          meta = {
            source: 'telegram', // 假设都是telegram文件
            size: fileDoc.file_size || 0,
            ext: fileDoc.file_name ? path.extname(fileDoc.file_name) : '.bin',
            fileType: fileDoc.file_type || 'unknown',
            path: fileDoc.file_path || null
          };
          console.log(`[optimizer] 构建基本元数据:`, meta);
        } else {
          console.log(`[optimizer] 直接查询未找到文件记录`);
        }
      } else {
        console.log(`[optimizer] db.findFileById 方法不可用`);
      }
    } catch (dbError) {
      console.log(`[optimizer] 直接查询失败:`, dbError.message);
    }
  }
  
  return meta;
}

// ---- 分布式锁（优先 redis/redlock，其次 in-process） ----
async function acquireLock(lockKey, ttl = 15000) {
  if (redlock) {
    try { return await redlock.lock(lockKey, ttl); } catch (e) { return null; }
  }
  if (redisClient) {
    const ok = await redisClient.set(lockKey, '1', 'PX', ttl, 'NX');
    if (ok) {
      return {
        release: async () => { await redisClient.del(lockKey); }
      };
    }
    return null;
  }
  // in-process lock
  if (inProcessLocks.has(lockKey)) return null;
  inProcessLocks.add(lockKey);
  return {
    release: async () => { inProcessLocks.delete(lockKey); }
  };
}

// ---- 等待锁 ----
async function waitForLock(lockKey, pollMs = 200, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    // try redis
    if (redisClient) {
      const exists = await redisClient.get(lockKey);
      if (!exists) return true;
    } else {
      if (!inProcessLocks.has(lockKey)) return true;
    }
    await new Promise(r => setTimeout(r, pollMs));
  }
  return false;
}

// ---- range helper ----
function parseRange(rangeHeader, size) {
  if (!rangeHeader) return null;
  const m = rangeHeader.match(/bytes=(\d*)-(\d*)/);
  if (!m) return null;
  const start = m[1] ? parseInt(m[1], 10) : 0;
  const end = m[2] ? parseInt(m[2], 10) : size - 1;
  if (isNaN(start) || isNaN(end) || start > end) return null;
  return { start, end };
}

// ---- 主中间件（改进版） ----
function fileOptimizerMiddleware(app) {
  return async function (req, res, next) {
    // only handle GET/HEAD
    if (!['GET', 'HEAD'].includes(req.method)) {
      return next();
    }
    
    // 🎯 修复：使用 originalUrl 检测文件路由
    const isFileRoute = req.originalUrl && req.originalUrl.startsWith('/file/');
    
    if (!isFileRoute) {
      return next();
    }

    // 🎯 修复：从 originalUrl 提取 fileId
    let fileId = req.params && req.params.fileId;
    if (!fileId) {
      const urlParts = req.originalUrl.split('/');
      fileId = urlParts[2];
    }

    if (!fileId) {
      return next();
    }

    console.log(`[optimizer] 🎯 拦截文件请求: ${fileId}`);
    console.log(`[optimizer] originalUrl: ${req.originalUrl}`);

    // 🎯 确保后续中间件能访问 fileId
    if (!req.params.fileId) {
      req.params.fileId = fileId;
    }

    const fc = app && app.locals && app.locals.fileController;
    if (!fc) {
      console.log('[optimizer] fileController 不存在，直接回退');
      return next();
    }

    // 🎯 改进：先检查缓存，再获取元数据（提高响应速度）
    let meta = null;
    let localPath = null;
    
    // 先尝试获取元数据来构建正确的缓存路径
    try { 
      meta = await askFileController(app, fileId); 
    } catch (e) { 
      console.error('[optimizer] 获取元数据异常:', e.message);
      meta = null; 
    }

    // Build local cache path
    const ext = (meta && meta.ext) ? meta.ext : '';
    localPath = getLocalCachePath(fileId, 'cached', ext);
    console.log(`[optimizer] 本地缓存路径: ${localPath}`);

    // 🎯 改进：如果缓存文件存在，直接使用（无论是否有元数据）
    if (fs.existsSync(localPath)) {
      try {
        const stat = fs.statSync(localPath);
        console.log(`[optimizer] 💾 缓存文件存在，直接提供: ${localPath}, 大小: ${stat.size}`);
        return streamFileToRes(req, res, localPath, stat.size);
      } catch (e) {
        console.error('[optimizer] 缓存文件读取错误', e);
        // 删除损坏的缓存文件
        try { fs.unlinkSync(localPath); } catch { /* ignore */ }
      }
    }

    // If there's an in-progress download promise, wait for it (multi-request merge)
    if (downloadQueue.has(fileId)) {
      console.log(`[optimizer] 等待进行中的下载任务: ${fileId}`);
      try {
        await downloadQueue.get(fileId);
        if (fs.existsSync(localPath)) {
          const stat = fs.statSync(localPath);
          console.log(`[optimizer] 下载任务完成，提供文件: ${localPath}`);
          return streamFileToRes(req, res, localPath, stat.size);
        } else {
          console.log(`[optimizer] 下载任务完成但文件不存在，回退`);
          return next();
        }
      } catch (e) {
        // download failed => remove queue entry and fallback
        console.error(`[optimizer] 下载任务失败:`, e.message);
        downloadQueue.delete(fileId);
        return next();
      }
    }

    // 🎯 改进：决策逻辑 - 即使没有完整元数据，如果有基本文件信息也处理
    let willHandle = false;
    if (meta && meta.source) {
      willHandle = true;
      console.log(`[optimizer] 决定处理此文件，来源: ${meta.source}`);
    } else if (meta) {
      // 有基本元数据但没有source，也尝试处理
      willHandle = true;
      meta.source = 'telegram'; // 设置默认source
      console.log(`[optimizer] 有基本元数据，决定处理此文件，使用默认source: telegram`);
    } else {
      console.log(`[optimizer] 无有效元数据，回退到 fileController`);
      return next();
    }

    // Acquire distributed lock to ensure single download across cluster
    const lockKey = `lock:file:${fileId}`;
    console.log(`[optimizer] 尝试获取锁: ${lockKey}`);
    const lock = await acquireLock(lockKey, 30000);
    if (!lock) {
      console.log(`[optimizer] 锁被占用，等待...`);
      const waited = await waitForLock(lockKey, 200, 30000);
      if (!waited) {
        console.log(`[optimizer] 等待锁超时，回退`);
        return next();
      }
      console.log(`[optimizer] 锁等待完成`);
    } else {
      console.log(`[optimizer] 成功获取锁`);
    }

    // From here: we are the owner OR waited for lock -> ensure only one download runs
    if (!downloadQueue.has(fileId)) {
      console.log(`[optimizer] 创建下载任务: ${fileId}`);
      const task = (async () => {
        try {
          console.log(`[optimizer] 开始下载任务，来源: ${meta.source}`);

          // 🎯 改进：下载逻辑，添加更多错误处理
          if (meta.source === 'local' && meta.path && fs.existsSync(meta.path)) {
            console.log(`[optimizer] 复制本地文件: ${meta.path} -> ${localPath}`);
            const dir = path.dirname(localPath);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            await pipelineAsync(fs.createReadStream(meta.path), fs.createWriteStream(localPath));
            console.log(`[optimizer] 本地文件复制完成`);
            return;
          }

          if ((meta.source === 'proxy' || meta.source === 'remote') && meta.path) {
            console.log(`[optimizer] 下载远程文件: ${meta.path}`);
            await fetchToLocal(meta.path, localPath);
            console.log(`[optimizer] 远程文件下载完成`);
            return;
          }

          if (meta.source === 'telegram') {
            console.log(`[optimizer] 下载 Telegram 文件`);
            // 🎯 改进：优先使用 downloadToLocal，然后是 provideLocalCopy
            if (fc && typeof fc.downloadToLocal === 'function') {
              await fc.downloadToLocal(fileId, localPath);
              console.log(`[optimizer] Telegram 文件下载完成 (downloadToLocal)`);
              return;
            } else if (fc && typeof fc.provideLocalCopy === 'function') {
              await fc.provideLocalCopy(fileId, localPath);
              console.log(`[optimizer] Telegram 文件下载完成 (provideLocalCopy)`);
              return;
            } else if (meta.path && meta.path.startsWith('http')) {
              console.log(`[optimizer] 通过 HTTP 下载 Telegram 文件: ${meta.path}`);
              await fetchToLocal(meta.path, localPath);
              console.log(`[optimizer] Telegram 文件下载完成 (HTTP)`);
              return;
            } else {
              // 🎯 新增：最后尝试使用 handleFileRequest 模拟下载
              console.log(`[optimizer] 尝试通过模拟请求下载`);
              await simulateDownload(fc, fileId, localPath);
              console.log(`[optimizer] 模拟下载完成`);
              return;
            }
          }

          // final fallback
          throw new Error('No valid download strategy');
        } finally {
          try { 
            if (lock && typeof lock.release === 'function') {
              await lock.release(); 
              console.log(`[optimizer] 锁已释放`);
            }
          } catch(e){
            console.error('[optimizer] 释放锁失败:', e);
          }
        }
      })();
      
      downloadQueue.set(fileId, task);
      try {
        await task;
        console.log(`[optimizer] 下载任务完成`);
      } catch (err) {
        downloadQueue.delete(fileId);
        console.error('[optimizer] 下载任务失败', err);
        return next();
      }
      downloadQueue.delete(fileId);
    } else {
      console.log(`[optimizer] 下载队列已存在，等待...`);
      try { 
        await downloadQueue.get(fileId); 
      } catch (e) { 
        downloadQueue.delete(fileId); 
        return next(); 
      }
    }

    // At this point, localPath should exist
    if (fs.existsSync(localPath)) {
      try {
        const stat = fs.statSync(localPath);
        console.log(`[optimizer] 🎉 最终提供文件: ${localPath}, 大小: ${stat.size}`);
        return streamFileToRes(req, res, localPath, stat.size);
      } catch (e) {
        console.error('[optimizer] 最终流式传输失败', e);
        return next();
      }
    }

    console.log(`[optimizer] 最终回退到 fileController`);
    return next();
  };
}

// 🎯 新增：模拟下载函数
async function simulateDownload(fileController, fileId, targetPath) {
  return new Promise((resolve, reject) => {
    const writeStream = fs.createWriteStream(targetPath);
    let responseEnded = false;

    const mockRes = {
      writeHead: () => {},
      setHeader: () => {},
      write: (chunk) => {
        if (writeStream.writable) {
          writeStream.write(chunk);
        }
        return true;
      },
      end: (chunk) => {
        if (!responseEnded) {
          responseEnded = true;
          if (chunk) {
            this.write(chunk);
          }
          writeStream.end(() => {
            resolve();
          });
        }
      },
      on: (event, callback) => {
        if (event === 'finish') {
          writeStream.on('finish', () => {
            if (!responseEnded) {
              responseEnded = true;
              resolve();
            }
          });
        }
      }
    };

    const mockReq = { 
      params: { fileId },
      method: 'GET'
    };

    // 设置超时
    const timeout = setTimeout(() => {
      if (!responseEnded) {
        writeStream.destroy();
        reject(new Error('模拟下载超时'));
      }
    }, 30000);

    fileController.handleFileRequest(mockReq, mockRes)
      .then(() => {
        clearTimeout(timeout);
        if (!responseEnded) {
          responseEnded = true;
          writeStream.end(() => resolve());
        }
      })
      .catch(error => {
        clearTimeout(timeout);
        writeStream.destroy();
        reject(error);
      });
  });
}

// ---- helper: stream local file to response with range support and smart limit ----
function streamFileToRes(req, res, filePath, totalSize) {
  if (res.headersSent) {
    return;
  }

  console.log(`[optimizer] 流式传输文件: ${filePath}, 大小: ${totalSize}`);

  const range = parseRange(req.headers.range, totalSize);
  if (range) {
    const { start, end } = range;
    const chunkSize = end - start + 1;
    console.log(`[optimizer] Range 请求: ${start}-${end}/${totalSize}`);
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${totalSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunkSize,
      'Content-Type': getMimeByExt(filePath)
    });
    const read = fs.createReadStream(filePath, { start, end });
    const limiter = smartLimitTransform(totalSize);
    return pipeline(read, limiter, res, (err) => {
      if (err) console.error('[optimizer] 流式传输 range 失败', err);
    });
  } else {
    console.log(`[optimizer] 完整文件传输`);
    res.writeHead(200, {
      'Content-Length': totalSize,
      'Content-Type': getMimeByExt(filePath)
    });
    const read = fs.createReadStream(filePath);
    const limiter = smartLimitTransform(totalSize);
    return pipeline(read, limiter, res, (err) => {
      if (err) console.error('[optimizer] 完整文件流式传输失败', err);
    });
  }
}

// ---- helper: basic fetch remote URL to localPath ----
function fetchToLocal(remoteUrl, localPath) {
  return new Promise((resolve, reject) => {
    console.log(`[optimizer] 开始获取远程文件: ${remoteUrl}`);
    const http = remoteUrl.startsWith('https') ? require('https') : require('http');
    const file = fs.createWriteStream(localPath + '.tmp');
    const req = http.get(remoteUrl, (resp) => {
      console.log(`[optimizer] 远程响应状态: ${resp.statusCode}`);
      if (resp.statusCode >= 300 && resp.statusCode < 400 && resp.headers.location) {
        resp.destroy();
        return fetchToLocal(resp.headers.location, localPath).then(resolve).catch(reject);
      }
      if (resp.statusCode !== 200) {
        file.close();
        fs.unlink(localPath + '.tmp', () => {});
        return reject(new Error('Fetch failed code ' + resp.statusCode));
      }
      resp.pipe(file);
      file.on('finish', () => {
        file.close(() => {
          fs.rename(localPath + '.tmp', localPath, (err) => {
            if (err) return reject(err);
            console.log(`[optimizer] 远程文件获取完成: ${localPath}`);
            resolve();
          });
        });
      });
    });
    req.on('error', (err) => {
      file.close();
      fs.unlink(localPath + '.tmp', () => {});
      reject(err);
    });
    req.setTimeout(60000, () => {
      req.abort();
      file.close();
      fs.unlink(localPath + '.tmp', () => {});
      reject(new Error('Fetch timeout'));
    });
  });
}

// ---- helper: basic mime by ext ----
function getMimeByExt(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.jpg': case '.jpeg': return 'image/jpeg';
    case '.png': return 'image/png';
    case '.webp': return 'image/webp';
    case '.mp4': return 'video/mp4';
    case '.mov': return 'video/quicktime';
    case '.gif': return 'image/gif';
    case '.pdf': return 'application/pdf';
    default: return 'application/octet-stream';
  }
}

module.exports = function (app) {
  return fileOptimizerMiddleware(app);
};