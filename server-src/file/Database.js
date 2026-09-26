// file/Database.js - 数据库查询
const { logger } = require('./utils');
const { MEMBER_CATEGORIES } = require('../../db/memberConfig');

class Database {
  constructor(dbManager) {
    this.dbManager = dbManager;
    this.models = {};
  }

  async getModel(modelName) {
    if (!this.models[modelName]) {
      this.models[modelName] = await this.dbManager.getModel(modelName);
    }
    return this.models[modelName];
  }

  async getMemberModel(categoryId) {
    return this.dbManager.getMemberModel(categoryId);
  }

  async findFileInModels(query, modelNames) {
    for (const modelName of modelNames) {
      const Model = await this.getModel(modelName);
      const fileDoc = await Model.findOne(query).lean();
      if (fileDoc) return { fileDoc, modelName };
    }
    return null;
  }

  async findFileById(fileId) {
    const query = {
      $or: [
        { 'photo.file_id': fileId },
        { 'video.file_id': fileId },
        { 'video.thumbnail.file_id': fileId },
        { 'video.thumb_file_id': fileId },
        { 'document.file_id': fileId }
      ]
    };

    console.log(`🔍 [Database] 查询文件: ${fileId.substring(0, 20)}...`);

    const baseModels = ['TelegramMessage', 'TestTelegramMessage', 'YYTelegramMessage'];
    let found = await this.findFileInModels(query, baseModels);

    if (!found) {
      for (const { id } of MEMBER_CATEGORIES) {
        const Model = await this.getMemberModel(id);
        const fileDoc = await Model.findOne(query).lean();
        if (fileDoc) {
          found = { fileDoc, modelName: `MemberMessage${id}` };
          break;
        }
      }
    }

    if (!found) {
      logger.file(`❌ 未找到文件记录: ${fileId}`);
      return null;
    }

    const { fileDoc, modelName } = found;
    const originToDbMap = {
      'yy': 'yyDB',
      'yx': 'yxDB',
      'daily': 'testDB',
      'member': 'memberDB',
      'telegram': 'telegramDB'
    };

    const dbName = originToDbMap[fileDoc.originDB] || 'telegramDB';

    logger.file(`🎯 文件来源: model=${modelName} originDB=${fileDoc.originDB} → dbName=${dbName}`);

    return { doc: fileDoc, dbName };
  }

  async updateCachedExtension(fileDoc, extension) {
    try {
      let modelName = 'TelegramMessage';

      if (fileDoc.originDB === 'daily') {
        modelName = 'TestTelegramMessage';
      } else if (fileDoc.originDB === 'yy') {
        modelName = 'YYTelegramMessage';
      } else if (fileDoc.originDB === 'member') {
        const chatId = String(fileDoc.chatId);
        const category = MEMBER_CATEGORIES.find((c) => c.chatId === chatId);
        if (category) {
          const Model = await this.getMemberModel(category.id);
          await Model.updateOne(
            { _id: fileDoc._id },
            { $set: { cached_extension: extension } }
          );
          return;
        }
      }

      const Model = await this.getModel(modelName);

      await Model.updateOne(
        { _id: fileDoc._id },
        { $set: { cached_extension: extension } }
      );
    } catch (dbErr) {
      logger.warn(`ℹ️ 扩展名记录失败: ${dbErr.message}`);
    }
  }

  async findFileByUniqueId(fileUniqueId) {
    const query = {
      $or: [
        { 'video.file_unique_id': fileUniqueId },
        { 'document.file_unique_id': fileUniqueId }
      ]
    };

    const TelegramMessage = await this.getModel('TelegramMessage');
    const TestTelegramMessage = await this.getModel('TestTelegramMessage');
    const YYTelegramMessage = await this.getModel('YYTelegramMessage');

    const memberModelPromises = MEMBER_CATEGORIES.map(({ id }) =>
      this.getMemberModel(id).then((Model) => Model.findOne(query).lean())
    );

    const results = await Promise.allSettled([
      TelegramMessage.findOne(query).lean(),
      TestTelegramMessage.findOne(query).lean(),
      YYTelegramMessage.findOne(query).lean(),
      ...memberModelPromises
    ]);

    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) {
        return result.value;
      }
    }

    return null;
  }
}

module.exports = Database;
