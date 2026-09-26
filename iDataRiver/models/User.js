// 用户数据模型
const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true, index: true },
  password: { type: String, required: true },

  email: { type: String, unique: true, sparse: true }, // 可选
  avatar: { type: String, default: "" },               // 可选
  role: { type: String, enum: ['user', 'admin'], default: 'user' },

  createdAt: { type: Date, default: Date.now },

  // 🔥 额外加两个和活跃关联的字段
  lastLoginAt: { type: Date, default: null, index: true },  // 最近上线时间
  lastSeenAt: { type: Date, default: null, index: true },   // 最近活跃时间
  isOnline: { type: Boolean, default: false, index: true }, // 当前在线状态（缓存字段）

  // 可选：快速跳转到最近一条活跃记录
  lastActivityId: { type: mongoose.Schema.Types.ObjectId, ref: 'UserActivity' },
});

// ✨ 索引设计
// 按用户类型 + 在线状态常规统计
userSchema.index({ role: 1, isOnline: 1 });

// 按注册时间或最近活动排序（比如排行榜）
userSchema.index({ lastSeenAt: -1, createdAt: -1 });

// 若未来统计月活或留存，也可用 createdAt/lastLoginAt 做范围查询
userSchema.index({ createdAt: 1 });
userSchema.index({ lastLoginAt: -1 });

module.exports = mongoose.model('User', userSchema);
