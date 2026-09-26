//聊天室数据模型
const mongoose = require('mongoose');

// ✅ 媒体子结构
const MediaItemSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ['photo', 'video', 'document', 'audio', 'voice', 'text'],
    required: true
  },
  url: { type: String },
  caption: { type: String },
  thumbnail: { type: String }
}, { _id: false });

// ✅ 主消息结构
const MessageSchema = new mongoose.Schema({
  username: { type: String, required: true },
  fromId: Number,

  text: { type: String },
  entities: [mongoose.Schema.Types.Mixed],

  // ✅ 单媒体字段
  photo: {
    file_id: String,
    file_unique_id: String,
    width: Number,
    height: Number,
    caption: String,
    file_path: String
  },
  video: {
    file_id: String,
    file_unique_id: String,
    thumb_file_id: String,
    duration: Number,
    width: Number,
    height: Number,
    caption: String,
    file_size: Number,
    file_path: String
  },
  document: {
    file_id: String,
    file_unique_id: String,
    file_name: String,
    mime_type: String,
    file_size: Number,
    thumb_file_id: String,
    caption: String,
    file_path: String
  },
  audio: {
    file_id: String,
    file_unique_id: String,
    duration: Number,
    mime_type: String,
    file_size: Number,
    file_path: String,
    caption: String
  },
  voice: {
    file_id: String,
    file_unique_id: String,
    duration: Number,
    mime_type: String,
    file_size: Number,
    file_path: String
  },

  // ✅ 多媒体组
  title: { type: String, default: '' },
  medias: [MediaItemSchema],
  thumbnail: { type: String },

  chatId: String,
  media_group_id: { type: String, default: null, index: true },

  telegramMessageId: { type: mongoose.Schema.Types.ObjectId, ref: 'TelegramMessage' },
  telegramMessageIds: [mongoose.Schema.Types.ObjectId],

  groupId: String,
  group_thumbnail: String,

  contentType: {
    type: String,
    enum: ['text', 'photo', 'video', 'media_group', 'document', 'audio', 'voice', null],
    default: 'text'
  },

  timestamp: { type: Date, default: Date.now },
  createdAt: { type: Date, default: Date.now },

  // ✅ 新增分页排序键
  historySortKey: { type: Number, required: true, index: true } // 毫秒时间戳
}, {
  timestamps: true,
  collection: 'messages'
});


// ✅ 索引区（关键性能优化）
MessageSchema.index({ createdAt: -1 });                  // 保留原索引
MessageSchema.index({ historySortKey: -1, _id: -1 });    // ✅ 分页核心复合索引（必加）
MessageSchema.index({ chatId: 1, historySortKey: -1 });  // ✅ 按群聊查询优化（如果有多个 chatId）
MessageSchema.index({ media_group_id: 1 });              // ✅ 多媒体组聚合优化

// ✅ 插入前自动补充排序键（防止为空）
MessageSchema.pre('save', function (next) {
  if (!this.historySortKey) {
    this.historySortKey = Date.now();
  }
  next();
});

module.exports = (connection) => {
  return connection.models.Message ||
    connection.model('Message', MessageSchema);
};
