//用户数据模型
module.exports = (conn) => {
  const mongoose = require('mongoose');

  const userSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true, index: true },
    password: { type: String, required: true },
    email: { type: String, unique: true, sparse: true },
    avatar: { type: String, default: "" },
    role: { type: String, enum: ['user', 'admin'], default: 'user' },
    createdAt: { type: Date, default: Date.now },
    lastLoginAt: { type: Date, default: null, index: true },
    lastSeenAt: { type: Date, default: null, index: true },
    isOnline: { type: Boolean, default: false, index: true },
    lastActivityId: { type: mongoose.Schema.Types.ObjectId, ref: 'UserActivity' },
  });

  userSchema.index({ role: 1, isOnline: 1 });
  userSchema.index({ lastSeenAt: -1, createdAt: -1 });
  userSchema.index({ createdAt: 1 });
  userSchema.index({ lastLoginAt: -1 });

  return conn.model('User', userSchema);
};
