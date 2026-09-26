const mongoose = require('mongoose');

const userDBURI = process.env.USER_DB_URI;
if (!userDBURI) throw new Error('USER_DB_URI 未设置');

const userConnection = mongoose.createConnection(userDBURI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  maxPoolSize: 5
});

userConnection.once('open', () => console.log('✅ 用户数据库连接成功'));
userConnection.on('error', (err) => console.error('❌ 用户数据库连接失败：', err));

module.exports = userConnection;
