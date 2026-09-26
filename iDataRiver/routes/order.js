const express = require("express");
const router = express.Router();
const { createOrder, handleNotify } = require("../controllers/orderController"); // 移除了 download 导入
const auth = require("../../middlewares/auth");
const Order = require("../models/Order"); // ✅ 导入 Order 模型

// 已有接口
router.post("/create", auth, createOrder);
router.post("/notify", handleNotify);
// 移除了 download 路由：router.get("/download", download);

// ✅ 新增：获取当前用户已购买的 groupId 列表
router.get("/purchased-groups", auth, async (req, res) => {
  try {
    const orders = await Order.find({
      userId: req.user._id,
      status: 'paid',
    }).select('groupId');

    const groupIds = orders.map(o => o.groupId?.toString()).filter(Boolean);
    res.json({ groupIds });
  } catch (err) {
    console.error("[获取订单失败]", err);
    res.status(500).json({ error: "服务器错误" });
  }
});

module.exports = router;
