//db/TelegramDBManager.js
require('dotenv').config({ path: './.env' });
const mongoose = require('mongoose');
const createTelegramMessageModel = require('./models/TelegramMessage');
const createMemberTelegramMessageModel = require('./models/memberTelegramMessage');
const { MEMBER_CATEGORIES, CHAT_TO_COLLECTION } = require('./memberConfig');
const {
  YY_CHAT_ID,
  YX_CHAT_ID,
  DAILY_UPDATE_CHAT_ID,
  DAILY_GOSSIP_CHAT_ID,
  DAILY_BEST_CHAT_ID,
} = require('./chatIds');
const logger = require('../utils/logger');

//从 .env 读取所需数据库 URI
const {
  TELEGRAM_DB_URI,
  TEST_DB_URI,
  YY_DB_URI,
  YX_DB_URI,
  MEMBER_DB_URI
} = process.env;

/**
 * chatId → 数据库映射表
 * 只列出 Telegram 推送项目中实际用到的频道
 */
const DB_MAP = {};
if (YY_CHAT_ID) DB_MAP[YY_CHAT_ID] = YY_DB_URI;
if (YX_CHAT_ID) DB_MAP[YX_CHAT_ID] = YX_DB_URI;
if (DAILY_UPDATE_CHAT_ID) DB_MAP[DAILY_UPDATE_CHAT_ID] = TEST_DB_URI;
if (DAILY_GOSSIP_CHAT_ID) DB_MAP[DAILY_GOSSIP_CHAT_ID] = TEST_DB_URI;
if (DAILY_BEST_CHAT_ID) DB_MAP[DAILY_BEST_CHAT_ID] = TEST_DB_URI;

// --- 会员频道（5 个分类，同一数据库、不同集合）---
for (const { chatId } of MEMBER_CATEGORIES) {
  DB_MAP[chatId] = MEMBER_DB_URI;
}

/** 默认 Telegram 数据库（兜底） */
const DEFAULT_DB_URI = TELEGRAM_DB_URI;

/** 缓存池 */
const connections = new Map(); // key: URI
const models = new Map();      // key: chatId

/**
 * 🩺 连接状态翻译
 */
function getReadableState(state) {
  const states = ['断开', '已连接', '连接中', '断开中'];
  return states[state] || '未知';
}

/**
 * 🧠 连接监控器
 */
function setupConnectionMonitoring(conn, label) {
  conn.on('connected', () => logger.db(`✅ 已连接`, { db: label }));
  conn.on('disconnected', () => logger.db(`⚠️ 已断开`, { db: label }));
  conn.on('reconnected', () => logger.db(`🔄 已重连`, { db: label }));
  conn.on('error', (err) =>
    logger.error(`❌ 数据库错误`, { db: label, error: err.message })
  );
}

/**
 * 🪄 获取连接（延迟创建 + 自动缓存 + 状态监控）
 */
async function getConnection(chatId) {
  const uri = DB_MAP[chatId] || DEFAULT_DB_URI;

  if (connections.has(uri)) return connections.get(uri);

  const conn = mongoose.createConnection(uri, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
    maxPoolSize: 5,
    serverSelectionTimeoutMS: 5000,
  });

  setupConnectionMonitoring(conn, `${chatId}`);

  connections.set(uri, conn);
  return conn;
}

/**
 * 🧩 获取模型（自动匹配连接 + 防重复注册）
 */
async function getModelByChatId(chatId) {
  if (models.has(chatId)) return models.get(chatId);

  const conn = await getConnection(chatId);
  const collectionName = CHAT_TO_COLLECTION[chatId];

  // 会员分类：每个 chatId 对应独立集合
  if (collectionName) {
    const modelName = `MemberMessage_${chatId}`;
    const MemberModel = createMemberTelegramMessageModel(conn, modelName, collectionName);
    models.set(chatId, MemberModel);
    logger.db(`🧩 会员模型创建成功`, { chatId, collection: collectionName });
    return MemberModel;
  }

  // 非会员：同一连接内复用 TelegramMessage 模型
  if (!DB_MAP[chatId]) {
    logger.warn(`⚠️ 未识别的 chatId，数据将写入默认库 (TELEGRAM_DB_URI)`, { chatId });
  }

  if (conn.models['TelegramMessage']) {
    models.set(chatId, conn.models['TelegramMessage']);
    return conn.models['TelegramMessage'];
  }

  const TelegramMessage = createTelegramMessageModel(conn);
  models.set(chatId, TelegramMessage);
  logger.db(`🧩 模型创建成功`, { chatId });
  return TelegramMessage;
}

/**
 * 📊 查看所有连接状态
 */
function getConnectionStatus() {
  return [...connections.entries()].map(([uri, conn]) => {
    const relatedChatIds = [...models.entries()]
      .filter(([_, m]) => m.db === conn)
      .map(([cid]) => cid);

    return {
      uri,
      dbName: conn.name,
      state: getReadableState(conn.readyState),
      chatIds: relatedChatIds,
      modelCount: relatedChatIds.length,
    };
  });
}

/**
 * 🧹 关闭所有连接（优雅退出）
 */
async function closeAllConnections() {
  for (const [uri, conn] of connections.entries()) {
    try {
      await conn.close();
      logger.db(`🛑 连接已关闭`, { uri });
    } catch (err) {
      logger.error(`❌ 关闭连接失败`, { uri, error: err.message });
    }
  }
  connections.clear();
  models.clear();
  logger.info('🔌 所有 TelegramDB 连接已关闭');
}

/**
 * 🚦 优雅关闭监听（Ctrl+C / PM2 停止时）
 */
process.on('SIGINT', async () => {
  await closeAllConnections();
  process.exit(0);
});
process.on('SIGTERM', async () => {
  await closeAllConnections();
  process.exit(0);
});

/**
 * 🚀 初始化
 */
function initialize() {
  logger.info('🚀 TelegramDBManager 已初始化');
}

initialize();

module.exports = {
  getModelByChatId,
  getConnectionStatus,
  closeAllConnections,
  initialize,
};
