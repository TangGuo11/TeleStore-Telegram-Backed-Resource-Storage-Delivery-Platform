// game-api/models/GameMessage.api.js - 游戏API专用数据模型
const { mongoose } = require('../db/mongoose');

const MediaSchema = new mongoose.Schema({
  type: { 
    type: String, 
    enum: ["photo", "video", "document", "thumbnail"], 
    required: true 
  },

  // Telegram 文件信息
  file_id: { type: String },

  file_unique_id: { 
    type: String,
    required: true 
  },

  file_name: String,
  mime_type: String,

  // 媒体元数据
  width: Number,
  height: Number,
  duration: Number,

  // 文件信息
  file_size: { 
    type: Number, 
    default: 0 
  },

  // 🔥 关键：TDLight缓存路径（如：documents/file_7.apk）
  file_path: { 
    type: String, 
    default: ""
  },

  caption: { 
    type: String, 
    default: "" 
  },

  // 缩略图
  thumb_file_id: String,
  thumb_path: String,

  // 🔥 新增：下载统计
  downloaded: { 
    type: Boolean, 
    default: false 
  },

  download_time: { 
    type: Date, 
    default: null 
  },

  cache_hits: { 
    type: Number, 
    default: 0 
  }
});

const GameMessageSchema = new mongoose.Schema(
  {
    // 🔥 必须：Telegram群组ID
    chatId: { 
      type: String, 
      required: true,
      index: true 
    },

    // 🔥 必须：Telegram消息ID（用于转发）
    messageId: { 
      type: Number, 
      required: true,
      index: true 
    },

    // 🔥 新增：游戏ID（业务标识）
    gameId: { 
      type: String, 
      required: true,
      index: true 
    },

    // 媒体组ID（可选）
    groupId: { 
      type: String, 
      index: true 
    },

    // 原始消息ID数组（媒体组用）
    originalMessageIds: [{ 
      type: Number 
    }],

    // 标题
    title: { 
      type: String, 
      default: "" 
    },

    // 描述
    description: { 
      type: String, 
      default: "" 
    },

    // 媒体文件数组
    medias: [MediaSchema],

    // 缩略图URL
    thumbnail: { 
      type: String 
    },

    // 原始消息时间戳
    timestamp: { 
      type: Date 
    },

    // 价格
    price: { 
      type: Number, 
      default: 0 
    },

    // 平台分类
    platform: {
      type: String,
      enum: ['pc', 'mobile', 'unknown'],
      default: 'unknown',
      index: true,
    },

    // 游戏分类
    category: {
      type: String,
      default: 'game',
      index: true
    },

    // 标签
    tags: [{
      type: String
    }],

    // 🔥 新增：下载统计
    download_count: {
      type: Number,
      default: 0
    },

    view_count: {
      type: Number,
      default: 0
    },

    // 🔥 新增：状态管理
    is_active: {
      type: Boolean,
      default: true,
      index: true
    },

    // 🔥 新增：TDLight相关
    tdlight_cached: {
      type: Boolean,
      default: false
    },

    tdlight_cache_time: {
      type: Date,
      default: null
    },

    // 🔥 新增：转发相关信息
    forwarded: {
      type: Boolean,
      default: false
    },

    forwarded_to_chat_id: {
      type: String,
      default: ""
    },

    forwarded_message_id: {
      type: Number,
      default: null
    }
  },
  {
    timestamps: true,
    collection: "game_messages",
  }
);

// 🔥 复合索引（提高查询性能）
GameMessageSchema.index({ chatId: 1, messageId: 1 }, { unique: true }); // 唯一索引，防止重复
GameMessageSchema.index({ gameId: 1, messageId: 1 });
GameMessageSchema.index({ 'medias.file_id': 1 });
GameMessageSchema.index({ 'medias.file_unique_id': 1 });
GameMessageSchema.index({ 'medias.file_path': 1 });
GameMessageSchema.index({ platform: 1, createdAt: -1 });
GameMessageSchema.index({ category: 1, createdAt: -1 });
GameMessageSchema.index({ price: 1, createdAt: -1 });
GameMessageSchema.index({ is_active: 1, platform: 1 });

// 🔥 缩略图相关索引（新增）
GameMessageSchema.index({ 'medias.thumb_file_id': 1 });
GameMessageSchema.index({ 'medias.thumb_path': 1 });
GameMessageSchema.index({ 
  'medias.type': 1, 
  'medias.thumb_file_id': 1,
  'medias.thumb_path': 1 
});
GameMessageSchema.index({ 
  'medias.type': 'video',
  'medias.thumb_file_id': 1,
  'medias.thumb_path': 1 
});

// 🔥 虚拟字段：获取主要媒体文件
GameMessageSchema.virtual('mainMedia').get(function() {
  if (this.medias && this.medias.length > 0) {
    const documentMedia = this.medias.find(m => m.type === 'document');
    if (documentMedia) return documentMedia;

    const videoMedia = this.medias.find(m => m.type === 'video');
    if (videoMedia) return videoMedia;

    return this.medias[0];
  }
  return null;
});

// 🔥 虚拟字段：是否有TDLight缓存
GameMessageSchema.virtual('hasTDLightCache').get(function() {
  if (!this.medias || this.medias.length === 0) return false;

  return this.medias.some(media => 
    media.file_path && 
    media.file_path.trim() !== '' &&
    (media.file_path.startsWith('documents/') || 
     media.file_path.startsWith('videos/') || 
     media.file_path.startsWith('photos/'))
  );
});

// 🔥 虚拟字段：获取视频缩略图（新增）
GameMessageSchema.virtual('videoThumbnails').get(function() {
  if (!this.medias || this.medias.length === 0) return [];

  return this.medias
    .filter(media => media.type === 'video' && (media.thumb_file_id || media.thumb_path))
    .map(media => ({
      fileUniqueId: media.file_unique_id,
      fileId: media.file_id,
      thumbFileId: media.thumb_file_id,
      thumbPath: media.thumb_path,
      width: media.width,
      height: media.height,
      duration: media.duration,
      hasThumbnail: !!(media.thumb_file_id || media.thumb_path)
    }));
});

// 🔥 方法：获取需要转发的文件
GameMessageSchema.methods.getFilesNeedForward = function() {
  if (!this.medias || this.medias.length === 0) return [];

  return this.medias.filter(media => {
    if (media.type !== 'document' && media.type !== 'video') return false;

    if (!media.file_unique_id || media.file_unique_id.trim() === '') return false;

    const hasCache = media.file_path && 
      media.file_path.trim() !== '' &&
      (media.file_path.startsWith('documents/') || 
       media.file_path.startsWith('videos/'));

    return !hasCache;
  });
};

// 🔥 方法：更新TDLight缓存信息
GameMessageSchema.methods.updateTDLightCache = function(fileUniqueId, filePath, fileSize = 0) {
  if (!this.medias || this.medias.length === 0) return false;

  for (const media of this.medias) {
    if (media.file_unique_id === fileUniqueId) {
      media.file_path = filePath;
      if (fileSize > 0) {
        media.file_size = fileSize;
      }
      media.downloaded = true;
      media.download_time = new Date();

      this.tdlight_cached = true;
      this.tdlight_cache_time = new Date();

      return true;
    }
  }

  return false;
};

// 🔥 方法：更新缩略图路径（新增）
GameMessageSchema.methods.updateThumbPath = function(fileUniqueId, thumbPath, thumbFileId = null) {
  if (!this.medias || this.medias.length === 0) return false;

  for (const media of this.medias) {
    if (media.file_unique_id === fileUniqueId) {
      media.thumb_path = thumbPath;
      
      if (thumbFileId) {
        media.thumb_file_id = thumbFileId;
      }
      
      media.downloaded = true;
      media.download_time = new Date();
      
      // 增加缓存命中次数
      media.cache_hits = (media.cache_hits || 0) + 1;
      
      return true;
    }
  }
  
  return false;
};

// 🔥 静态方法：按file_unique_id查找
GameMessageSchema.statics.findByFileUniqueId = function(fileUniqueId) {
  return this.findOne({ 'medias.file_unique_id': fileUniqueId })
    .select('chatId messageId gameId medias.$')
    .lean();
};

// 🔥 静态方法：按thumb_file_id查找（新增）
GameMessageSchema.statics.findByThumbFileId = function(thumbFileId) {
  return this.findOne({ 
    'medias.thumb_file_id': thumbFileId 
  })
  .select('chatId messageId gameId medias.$')
  .lean();
};

// 🔥 静态方法：更新file_path
GameMessageSchema.statics.updateFilePath = function(fileUniqueId, filePath, fileSize = 0) {
  const updateData = {
    'medias.$.file_path': filePath,
    'medias.$.downloaded': true,
    'medias.$.download_time': new Date(),
    tdlight_cached: true,
    tdlight_cache_time: new Date()
  };

  if (fileSize > 0) {
    updateData['medias.$.file_size'] = fileSize;
  }

  return this.updateOne(
    { 'medias.file_unique_id': fileUniqueId },
    { $set: updateData }
  );
};

// 🔥 静态方法：更新thumb_path（新增）
GameMessageSchema.statics.updateThumbPath = function(fileUniqueId, thumbPath, thumbFileId = null) {
  const updateData = {
    'medias.$.thumb_path': thumbPath,
    'medias.$.downloaded': true,
    'medias.$.download_time': new Date(),
    'medias.$.cache_hits': { $inc: 1 }
  };

  if (thumbFileId) {
    updateData['medias.$.thumb_file_id'] = thumbFileId;
  }

  return this.updateOne(
    { 'medias.file_unique_id': fileUniqueId },
    { $set: updateData }
  );
};

// 🔥 静态方法：查找需要转发的文件
GameMessageSchema.statics.findFilesNeedForward = function(limit = 100) {
  return this.find({
    'medias.type': { $in: ['document', 'video'] },
    'medias.file_unique_id': { $exists: true, $ne: '' },
    $or: [
      { 'medias.file_path': { $exists: false } },
      { 'medias.file_path': '' },
      { 'medias.file_path': { $not: /^(documents|videos)\// } }
    ],
    is_active: true
  })
  .limit(limit)
  .select('chatId messageId gameId medias')
  .lean();
};

// 🔥 静态方法：查找需要下载缩略图的视频（新增）
GameMessageSchema.statics.findVideosNeedThumbnail = function(limit = 100) {
  return this.find({
    'medias.type': 'video',
    'medias.thumb_file_id': { $exists: true, $ne: '' },
    $or: [
      { 'medias.thumb_path': { $exists: false } },
      { 'medias.thumb_path': '' },
      { 'medias.thumb_path': { $regex: /^$|^thumb_/ } }
    ],
    is_active: true
  })
  .limit(limit)
  .select('gameId medias')
  .lean();
};

// 🔥 静态方法：批量更新缩略图路径（新增）
GameMessageSchema.statics.batchUpdateThumbPaths = function(updates) {
  if (!Array.isArray(updates) || updates.length === 0) {
    return Promise.resolve({ modifiedCount: 0 });
  }

  const bulkOps = updates.map(update => ({
    updateOne: {
      filter: { 'medias.file_unique_id': update.fileUniqueId },
      update: {
        $set: {
          'medias.$.thumb_path': update.thumbPath,
          'medias.$.downloaded': true,
          'medias.$.download_time': new Date()
        },
        $inc: { 'medias.$.cache_hits': 1 }
      }
    }
  }));

  return this.bulkWrite(bulkOps);
};

// 🔥 静态方法：获取游戏的所有缩略图信息（新增）
GameMessageSchema.statics.getGameThumbnails = function(gameId) {
  return this.find({ gameId })
    .select('gameId medias')
    .lean()
    .then(docs => {
      const thumbnails = [];
      
      docs.forEach(doc => {
        doc.medias.forEach(media => {
          if (media.thumb_file_id || media.thumb_path) {
            thumbnails.push({
              gameId: doc.gameId,
              fileUniqueId: media.file_unique_id,
              fileId: media.file_id,
              thumbFileId: media.thumb_file_id,
              thumbPath: media.thumb_path,
              type: media.type,
              width: media.width,
              height: media.height,
              hasThumbFileId: !!media.thumb_file_id,
              hasThumbPath: !!media.thumb_path
            });
          }
        });
      });
      
      return thumbnails;
    });
};

// 🔥 静态方法：获取缩略图统计信息（新增）
GameMessageSchema.statics.getThumbnailStats = function() {
  return this.aggregate([
    { $match: { is_active: true } },
    { $unwind: "$medias" },
    { $match: { 
      'medias.type': 'video',
      'medias.thumb_file_id': { $exists: true, $ne: '' }
    }},
    { 
      $group: {
        _id: null,
        totalVideos: { $sum: 1 },
        withThumbPath: {
          $sum: {
            $cond: [
              { $and: [
                { $ne: ["$medias.thumb_path", ""] },
                { $ne: ["$medias.thumb_path", null] }
              ]},
              1,
              0
            ]
          }
        },
        avgWidth: { $avg: "$medias.width" },
        avgHeight: { $avg: "$medias.height" }
      }
    },
    {
      $project: {
        _id: 0,
        totalVideos: 1,
        withThumbPath: 1,
        withoutThumbPath: { $subtract: ["$totalVideos", "$withThumbPath"] },
        completionRate: {
          $cond: [
            { $eq: ["$totalVideos", 0] },
            0,
            { $multiply: [{ $divide: ["$withThumbPath", "$totalVideos"] }, 100] }
          ]
        },
        avgWidth: { $round: ["$avgWidth", 2] },
        avgHeight: { $round: ["$avgHeight", 2] }
      }
    }
  ]);
};

// 🔥 静态方法：查找有缩略图的游戏（新增）
GameMessageSchema.statics.findGamesWithThumbnails = function(limit = 50) {
  return this.aggregate([
    { $match: { is_active: true } },
    { $unwind: "$medias" },
    { $match: { 
      'medias.type': 'video',
      'medias.thumb_file_id': { $exists: true, $ne: '' }
    }},
    {
      $group: {
        _id: "$gameId",
        videoCount: { $sum: 1 },
        thumbnailsCount: {
          $sum: {
            $cond: [
              { $and: [
                { $ne: ["$medias.thumb_path", ""] },
                { $ne: ["$medias.thumb_path", null] }
              ]},
              1,
              0
            ]
          }
        },
        lastUpdated: { $max: "$updatedAt" }
      }
    },
    {
      $project: {
        gameId: "$_id",
        _id: 0,
        videoCount: 1,
        thumbnailsCount: 1,
        missingThumbnails: { $subtract: ["$videoCount", "$thumbnailsCount"] },
        completionRate: {
          $cond: [
            { $eq: ["$videoCount", 0] },
            0,
            { $multiply: [{ $divide: ["$thumbnailsCount", "$videoCount"] }, 100] }
          ]
        },
        lastUpdated: 1
      }
    },
    { $sort: { missingThumbnails: -1, lastUpdated: -1 } },
    { $limit: limit }
  ]);
};

module.exports = mongoose.model("GameMessageAPI", GameMessageSchema);