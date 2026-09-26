// 用户活跃数据模型
const mongoose = require('mongoose');

const userActivitySchema = new mongoose.Schema({
  userId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User', 
    required: false
  },
  visitorId: { type: String },
  username: { type: String, default: 'Guest' },
  loginAt: { type: Date, default: Date.now },
  lastSeenAt: { type: Date, default: Date.now },
  logoutAt: { type: Date, default: null },
  durationSec: { type: Number, default: null },
  pageStats: {
    home: { type: Number, default: 0 },
    chat: { type: Number, default: 0 },
    works: { type: Number, default: 0 },
    lastPath: { type: String, default: '' }
  },
  meta: { type: Object, default: {} }
}, { timestamps: true });

userActivitySchema.index({ userId: 1, loginAt: -1 });
userActivitySchema.index({ visitorId: 1, loginAt: -1 });
userActivitySchema.index({ loginAt: -1 });
userActivitySchema.index({ lastSeenAt: 1 });

// ✅ 必须是函数式导出 + return conn.model()
module.exports = (conn) => {
  return conn.model('UserActivity', userActivitySchema);
};
