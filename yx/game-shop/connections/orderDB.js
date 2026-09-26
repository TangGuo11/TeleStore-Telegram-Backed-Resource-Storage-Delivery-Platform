const mongoose = require('mongoose');

const orderDBURI = process.env.ORDER_DB_URI;
if (!orderDBURI) throw new Error('ORDER_DB_URI 未设置');

const orderConnection = mongoose.createConnection(orderDBURI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  maxPoolSize: 5
});

orderConnection.once('open', () => console.log('✅ 订单数据库连接成功'));
orderConnection.on('error', (err) => console.error('❌ 订单数据库连接失败：', err));

module.exports = orderConnection;
