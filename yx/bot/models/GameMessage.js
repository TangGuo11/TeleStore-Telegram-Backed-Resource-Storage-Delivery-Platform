// GameMessage.js - 游戏机器人专用数据模型
const mongoose = require("mongoose");

const MediaSchema = new mongoose.Schema({
  type: { type: String, enum: ["photo", "video", "document"], required: true },

  file_id: String,
  file_unique_id: { type: String, index: true },
  file_name: String,
  mime_type: String,

  width: Number,
  height: Number,
  duration: Number,

  file_size: Number,
  file_path: String, // TDLight 缓存后更新

  caption: String,

  // 缩略图（视频、文档）
  thumb_file_id: String,
  thumb_path: String,
});

const GameMessageSchema = new mongoose.Schema(
  {
    // Telegram 媒体组 ID（无媒体组则为 null）
    groupId: { type: String, index: true },

    // 一条游戏消息必定属于一个 chat
    chatId: { type: String, index: true },

    // 🔥 新增：该条消息的 message_id (用于转发、复制、找文件)
    messageId: { type: Number, index: true },

    // 原始 Telegram 的 message_ids（如果是媒体组，一组最多 10 个）
    originalMessageIds: [{ type: Number }],

    // 标题（来自 caption）
    title: { type: String, default: "" },

    // 一组媒体（最多 10 个）
    medias: [MediaSchema],

    // 最佳封面（自动选第一个视频 thumbnail 或图片）
    thumbnail: { type: String },

    // Telegram 消息时间
    timestamp: { type: Date },

    // 🔥 新增：游戏价格（后台解析 caption 后保存）
    price: { type: Number, default: 0 },

    // 🔥 未来绑定游戏用（可选）
    gameId: { type: String, index: true },

    // 🔥 平台分类
    platform: {
      type: String,
      enum: ['pc', 'mobile', 'unknown'],
      default: 'unknown',
      index: true
    }
  },
  {
    timestamps: true,
    collection: "game_messages",
  }
);

// 复合索引
GameMessageSchema.index({ chatId: 1, groupId: 1 });
GameMessageSchema.index({ chatId: 1, messageId: 1 }); // 🔥 新增：用于精准查找消息
GameMessageSchema.index({ platform: 1, createdAt: -1 });

module.exports = mongoose.model("GameMessage", GameMessageSchema);
