const mongoose = require('mongoose');
const userConnection = require('../connections/userDB');

const UserSchema = new mongoose.Schema({
  username: String,
  password: String,
  avatar: String,
  role: String,
  isOnline: Boolean,
  lastActivityId: mongoose.Schema.Types.ObjectId,
  lastLoginAt: Date,
  lastSeenAt: Date
}, {
  collection: 'users'
});

module.exports = userConnection.model('User', UserSchema);
