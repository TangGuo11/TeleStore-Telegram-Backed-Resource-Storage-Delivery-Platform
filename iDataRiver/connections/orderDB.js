// connections/orderDB.js
const mongoose = require("mongoose");

const orderDBURI = process.env.ORDER_DB_URI || process.env.MONGODB_URI;
if (!orderDBURI) throw new Error('ORDER_DB_URI / MONGODB_URI is not set');

const orderConnection = mongoose.createConnection(orderDBURI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

orderConnection.once("open", () => {
  console.log("✅ 订单数据库连接成功");
});

orderConnection.on("error", (err) => {
  console.error("❌ 订单数据库连接失败：", err);
});

module.exports = orderConnection;
