// db/DBManager.js
const mongoose = require('mongoose');
const models = require('./models');
const createMemberTelegramMessageModel = require('./models/memberTelegramMessage');
const { MEMBER_CATEGORIES, getCategoryConfig } = require('./memberConfig');
const logger = require('../utils/logger');

class DBManager {
  constructor() {
    this.connections = new Map();
    this.models = new Map();
    this.connectionStatus = new Map();

    // 🔹 内存缓存：最近 300 条 fileId / fileUniqueId 查询结果
    this.fileCache = new Map();
    this.MAX_CACHE = 300;
  }

  /** ==================== 懒加载连接 ==================== */
  async getConnection(dbName) {
    if (this.connections.has(dbName)) return this.connections.get(dbName);

    const uri = process.env[`${dbName.toUpperCase().replace(/DB$/, '_DB')}_URI`];
    if (!uri) throw new Error(`❌ 缺少数据库连接URI: ${dbName}`);

    logger.db(`正在连接数据库: ${dbName}`);
    const conn = mongoose.createConnection(uri, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      bufferCommands: false,
      maxPoolSize: 20,
    });

    this.setupConnectionMonitoring(conn, dbName);
    this.connections.set(dbName, conn);
    await this.waitForConnection(conn, dbName);
    logger.db(`✅ 数据库连接成功: ${dbName}`);
    return conn;
  }

  /** 等待连接 */
  waitForConnection(conn, dbName, timeoutMs = 8000) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`连接超时: ${dbName}`));
      }, timeoutMs);

      if (conn.readyState === 1) {
        clearTimeout(timeout);
        return resolve(true);
      }

      conn.once('open', () => {
        clearTimeout(timeout);
        resolve(true);
      });
      conn.once('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  }

  /** 设置连接监控 */
  setupConnectionMonitoring(conn, dbName) {
    conn.on('connected', () => {
      this.connectionStatus.set(dbName, 'connected');
      logger.db(`数据库连接已建立`, { db: dbName });
    });

    conn.on('error', (err) => {
      this.connectionStatus.set(dbName, 'error');
      logger.error(`数据库连接错误`, { db: dbName, error: err.message });
    });

    conn.on('disconnected', () => {
      this.connectionStatus.set(dbName, 'disconnected');
      logger.warn(`数据库连接断开`, { db: dbName });
    });

    conn.on('reconnected', () => {
      this.connectionStatus.set(dbName, 'reconnected');
      logger.db(`数据库重新连接`, { db: dbName });
    });
  }

  /** ==================== 模型初始化（防重注册） ==================== */
  async getModel(modelName) {
    if (this.models.has(modelName)) return this.models.get(modelName);

    // 模型配置表
    const configs = {
      User: { factory: models.createUserModel, db: 'userDB' },
      Message: { factory: models.createMessageModel, db: 'chatDB' },
      TelegramMessage: { factory: models.createTelegramMessageModel, db: 'telegramDB' },
      TestTelegramMessage: { factory: models.createTestTelegramMessageModel, db: 'testDB' },
      YYTelegramMessage: { factory: models.createYYTelegramMessageModel, db: 'yyDB' },
      UserActivity: { factory: models.createUserActivityModel, db: 'userDB' },
      Purchase: { factory: models.createPurchaseModel, db: 'userDB' },
      Product: { factory: models.createProductModel, db: 'userDB' },
      FeedMessage: { factory: models.createFeedMessageModel, db: 'testDB' },
      FeedDigest: { factory: models.createFeedDigestModel, db: 'testDB' },
    };

    const config = configs[modelName];
    if (!config) throw new Error(`❌ 未找到模型配置: ${modelName}`);

    const conn = await this.getConnection(config.db);
    if (conn.models[modelName]) {
      this.models.set(modelName, conn.models[modelName]);
      return conn.models[modelName];
    }

    const model = config.factory(conn);
    this.models.set(modelName, model);
    logger.db(`✅ 模型已加载: ${modelName} @${config.db}`);
    return model;
  }

  /** 获取会员 VIP 分类模型（1-5） */
  async getMemberModel(categoryId) {
    const category = Number(categoryId);
    const config = getCategoryConfig(category);
    if (!config) throw new Error(`❌ 无效会员分类: ${categoryId}`);

    const modelKey = `MemberMessage${category}`;
    if (this.models.has(modelKey)) return this.models.get(modelKey);

    const conn = await this.getConnection('memberDB');
    const modelName = `MemberMessage${category}`;

    if (conn.models[modelName]) {
      this.models.set(modelKey, conn.models[modelName]);
      return conn.models[modelName];
    }

    const model = createMemberTelegramMessageModel(conn, modelName, config.collection);
    this.models.set(modelKey, model);
    logger.db(`✅ 会员模型已加载: ${modelName} @memberDB/${config.collection}`);
    return model;
  }

  /** ==================== 文件查询缓存层 ==================== */

  cacheSet(key, value) {
    if (this.fileCache.size >= this.MAX_CACHE) {
      const firstKey = this.fileCache.keys().next().value;
      this.fileCache.delete(firstKey);
    }
    this.fileCache.set(key, { value, timestamp: Date.now() });
  }

  cacheGet(key) {
    const cached = this.fileCache.get(key);
    if (!cached) return null;
    return cached.value;
  }

/** 按 fileId 查找文件（带缓存 + originDB + fileType） */
async findFileByFileId(fileId) {
  const cached = this.cacheGet(fileId);
  if (cached) {
    console.log(`🔍 [DBManager] 缓存命中: ${fileId.substring(0, 20)}...`);
    return cached;
  }

  const query = {
    $or: [
      { 'photo.file_id': fileId },
      { 'video.file_id': fileId },
      { 'video.thumbnail.file_id': fileId },
      { 'video.thumb_file_id': fileId },
      { 'document.file_id': fileId },
    ],
  };

  const modelsToSearch = [
    { name: 'TelegramMessage', db: 'telegramDB' },
    { name: 'TestTelegramMessage', db: 'testDB' },
    { name: 'YYTelegramMessage', db: 'yyDB' },
  ];

  console.log(`🔍 [DBManager] 开始查询文件: ${fileId.substring(0, 20)}...`);

  for (const { name, db } of modelsToSearch) {
    const Model = await this.getModel(name);
    const doc = await Model.findOne(query).lean();
    if (doc) {
      console.log(`✅ [DBManager] 在 ${name} 中找到文件`);
      
      const fileType = this.detectFileType(doc, fileId);
      const originDB = doc.originDB;
      
      const resultDbName = this.getDbNameFromOriginDB(originDB) || db;
      
      console.log(`🔍 [DBManager] 详细映射信息:`, {
        modelName: name,
        modelDb: db,
        originDB: originDB,
        resultDbName: resultDbName,
        chatId: doc.chatId
      });

      const result = {
        doc,
        modelName: name,
        dbName: resultDbName,
        originDB: originDB,
        fileType,
        cacheAt: Date.now(),
      };

      this.cacheSet(fileId, result);
      return result;
    }
  }

  // 会员 VIP 五个集合
  for (const { id } of MEMBER_CATEGORIES) {
    const Model = await this.getMemberModel(id);
    const doc = await Model.findOne(query).lean();
    if (doc) {
      console.log(`✅ [DBManager] 在 MemberMessage${id} 中找到文件`);
      const fileType = this.detectFileType(doc, fileId);
      const result = {
        doc,
        modelName: `MemberMessage${id}`,
        dbName: 'memberDB',
        originDB: 'member',
        fileType,
        cacheAt: Date.now(),
      };
      this.cacheSet(fileId, result);
      return result;
    }
  }

  console.log(`❌ [DBManager] 未在任何模型中找到文件: ${fileId}`);
  return null;
}

// 🔧 新增：根据 originDB 字段获取数据库名称
getDbNameFromOriginDB(originDB) {
  const originToDbMap = {
    'yy': 'yyDB',
    'yx': 'yxDB', 
    'daily': 'testDB',
    'member': 'memberDB',
    'telegram': 'telegramDB'
  };
  
  const result = originToDbMap[originDB];
  console.log(`🔍 [DBManager] originDB映射: ${originDB} -> ${result}`);
  return result;
}

/** 按 fileUniqueId 查找文件（带缓存 + originDB） */
async findFileByUniqueId(fileUniqueId) {
  const cached = this.cacheGet(fileUniqueId);
  if (cached) {
    console.log(`🔍 [DBManager] 缓存命中(uniqueId): ${fileUniqueId.substring(0, 20)}...`);
    return cached;
  }

  const query = {
    $or: [
      { 'photo.file_unique_id': fileUniqueId },
      { 'video.file_unique_id': fileUniqueId },
      { 'video.thumbnail.file_unique_id': fileUniqueId },
      { 'document.file_unique_id': fileUniqueId },
    ],
  };

  const modelsToSearch = [
    { name: 'TelegramMessage', db: 'telegramDB' },
    { name: 'TestTelegramMessage', db: 'testDB' },
    { name: 'YYTelegramMessage', db: 'yyDB' },
  ];

  console.log(`🔍 [DBManager] 开始查询uniqueId: ${fileUniqueId.substring(0, 20)}...`);

  for (const { name, db } of modelsToSearch) {
    const Model = await this.getModel(name);
    const doc = await Model.findOne(query).lean();
    if (doc) {
      console.log(`✅ [DBManager] 在 ${name} 中找到文件(uniqueId)`);
      
      const originDB = doc.originDB;
      const resultDbName = this.getDbNameFromOriginDB(originDB) || db;
      
      const result = {
        doc,
        modelName: name,
        dbName: resultDbName,
        originDB: originDB,
        cacheAt: Date.now(),
      };

      this.cacheSet(fileUniqueId, result);
      return result;
    }
  }

  for (const { id } of MEMBER_CATEGORIES) {
    const Model = await this.getMemberModel(id);
    const doc = await Model.findOne(query).lean();
    if (doc) {
      const result = {
        doc,
        modelName: `MemberMessage${id}`,
        dbName: 'memberDB',
        originDB: 'member',
        cacheAt: Date.now(),
      };
      this.cacheSet(fileUniqueId, result);
      return result;
    }
  }

  console.log(`❌ [DBManager] 未找到文件(uniqueId): ${fileUniqueId}`);
  return null;
}

  /** 文件类型识别 */
  detectFileType(doc, fileId) {
    if (doc.photo?.file_id === fileId) return 'photo';
    if (doc.video) {
      if (doc.video.file_id === fileId) return 'video';
      if (doc.video.thumbnail?.file_id === fileId) return 'thumbnail';
      if (doc.video.thumb_file_id === fileId) return 'thumb_file';
    }
    if (doc.document?.file_id === fileId) return 'document';
    return 'unknown';
  }

  /** ==================== 通用 CRUD ==================== */
  async insert(modelName, data) {
    const Model = await this.getModel(modelName);
    const result = await Model.create(data);
    return result;
  }

  async find(modelName, query = {}, options = {}) {
    const Model = await this.getModel(modelName);
    return Model.find(query, null, options).lean();
  }

  async update(modelName, filter, update, options = {}) {
    const Model = await this.getModel(modelName);
    return Model.updateOne(filter, update, options);
  }

  /** ==================== 健康与退出 ==================== */
  getConnectionStatus() {
    const result = {};
    for (const [name, conn] of this.connections) {
      result[name] = this.getReadyStateText(conn.readyState);
    }
    return result;
  }

  getReadyStateText(state) {
    return ['disconnected', 'connected', 'connecting', 'disconnecting'][state] || 'unknown';
  }

  async close() {
    for (const [name, conn] of this.connections) {
      await conn.close();
      logger.db(`数据库连接已关闭`, { db: name });
    }
    this.connections.clear();
    this.models.clear();
    this.fileCache.clear();
  }


async init() {
  // 提前加载核心模型（非懒加载的）
  const preloadModels = ['User', 'Message', 'TelegramMessage', 'TestTelegramMessage', 'YYTelegramMessage'];
  for (const name of preloadModels) {
    await this.getModel(name);
  }
  return true;
}


}

/** 单例实例 */
const dbManager = new DBManager();

/** 优雅退出 */
process.on('SIGINT', async () => {
  logger.db('收到 SIGINT，关闭数据库连接...');
  await dbManager.close();
  process.exit(0);
});
process.on('SIGTERM', async () => {
  logger.db('收到 SIGTERM，关闭数据库连接...');
  await dbManager.close();
  process.exit(0);
});

module.exports = dbManager;