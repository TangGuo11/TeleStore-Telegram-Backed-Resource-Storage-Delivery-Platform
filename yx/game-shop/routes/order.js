// yx/game-shop/routes/order.js

const express = require('express');
const mongoose = require('mongoose');
const auth = require('../../middlewares/auth');
const idr = require('../services/idatariver');
const axios = require('axios');

const Game = require('../models/Game');
const Order = require('../models/Order');
const User = require('../models/User');

const router = express.Router();

/*----------- 🔧 常量配置 ------------*/
const IDATARIVER_API = process.env.IDATARIVER_BASE_URL || 'https://api.idatariver.com';
const AUTH_HEADER = {
  Authorization: `Bearer ${process.env.IDATARIVER_SECRET}`
};

// ⏱ 4分钟过期
const ORDER_EXPIRE_MS = 4 * 60 * 1000;


/*----------- 🎮 创建订单 ------------*/
router.post('/create', auth, async (req, res) => {
  console.log('🎮 [ORDER][CREATE]', {
    userId: req.user?.id,
    body: req.body,
    time: new Date().toISOString()
  });

  const { gameId } = req.body;

  if (!req.user?.id)
    return res.status(401).json({ message: '未登录' });

  if (!gameId)
    return res.status(400).json({ message: 'gameId required' });

  try {
    if (!mongoose.Types.ObjectId.isValid(req.user.id))
      return res.status(400).json({ message: '非法用户ID' });

    const user = await User.findById(req.user.id);
    if (!user)
      return res.status(404).json({ message: '用户不存在' });

    const game = await Game.findOne({ gameId });
    if (!game)
      return res.status(404).json({ message: '游戏不存在' });

    if (typeof game.price !== 'number' || game.price <= 0)
      return res.status(500).json({ message: '游戏价格异常' });

    /*----------- 已购买检查 ------------*/
    const existingPaid = await Order.findOne({
      userId: user._id,
      gameId,
      status: 'paid'
    });

    if (existingPaid)
      return res.status(400).json({ message: '您已购买过该游戏' });

    /*----------- 查找已有 pending ------------*/
    let pending = await Order.findOne({
      userId: user._id,
      gameId,
      status: 'pending'
    });

    // 如果 pending 已过期但 TTL 还没删，主动清理
    if (pending && pending.expireAt && pending.expireAt < new Date()) {
      await Order.deleteOne({ _id: pending._id });
      pending = null;
    }

    // 如果存在有效 pending，直接复用（不延长时间）
    if (pending && pending.alipayUrl && pending.wxpayUrl) {
      console.log('🔁 复用已有 pending 订单');
      return res.json({
        success: true,
        orderId: pending._id,
        alipayUrl: pending.alipayUrl,
        wxpayUrl: pending.wxpayUrl
      });
    }

    /*----------- 创建新订单 ------------*/
    const expireTime = new Date(Date.now() + ORDER_EXPIRE_MS);

    const order = await Order.create({
      userId: user._id,
      gameId: game.gameId,
      title: game.title,

      amountCNY: game.price,
      status: 'pending',

      payPlatform: 'idataRiver',
      expireAt: expireTime
    });

    console.log('📝 本地订单创建成功:', order._id.toString());

    /*----------- 获取 BUYMEABTC 项目 ------------*/
    const listRes = await axios.get(
      `${IDATARIVER_API}/mapi/project/list`,
      { headers: AUTH_HEADER }
    );

    const targetProject =
      listRes.data?.result?.projects?.find(
        p => p.type === 'BUYMEABTC'
      );

    if (!targetProject)
      throw new Error('未找到 BUYMEABTC 项目');

    const projectId = targetProject.id;

    /*----------- 调用 idatariver 创建支付订单 ------------*/
    const payRes = await idr.createOrder({
      projectId,
      amountCNY: game.price,
      privateId: order._id.toString(),
      name: `user_${user._id}`,
      message: `购买游戏：${game.title}`,
      localOrderId: order._id.toString(),
      callbackUrl: `${process.env.BASE_URL}/game-api/order/notify`,
      redirectUrl: `${process.env.BASE_URL}/public/download.html?orderId=${order._id}`
    });

    order.payOrderId = payRes.orderId;
    order.alipayUrl = payRes.alipayUrl || '';
    order.wxpayUrl = payRes.wxpayUrl || '';

    await order.save();

    console.log('🔗 支付链接生成成功');

    res.json({
      success: true,
      orderId: order._id,
      alipayUrl: order.alipayUrl,
      wxpayUrl: order.wxpayUrl
    });

  } catch (err) {
    console.error('❌ [ORDER][CREATE ERROR]', err.message);
    res.status(500).json({ message: err.message || '创建订单失败' });
  }
});


/*----------- 💰 支付回调 ------------*/
router.post('/notify', async (req, res) => {
  try {
    console.log('📬 收到支付回调:', req.body);

    const { result, event } = req.body;

    if (!result || !result.id)
      return res.status(400).send('缺少订单ID');

    if (event !== 'ORDER_COMPLETED')
      return res.status(200).send('ignore');

    const id = result.id;

    /*----------- 二次查询 ------------*/
    const infoRes = await axios.get(
      `${IDATARIVER_API}/mapi/order/info`,
      {
        params: { id },
        headers: AUTH_HEADER
      }
    );

    const orderInfo = infoRes.data?.result;

    if (!orderInfo || orderInfo.status !== 'DONE')
      return res.status(200).send('ignore');

    /*----------- 查本地订单 ------------*/
    const order = await Order.findOne({
      payOrderId: id,
      payPlatform: 'idataRiver'
    });

    if (!order)
      return res.status(404).send('not found');

    /*----------- 金额校验 ------------*/
    const paidAmount = Number(orderInfo.amount);
    const expectedAmount = Number(order.amount);

    if (!paidAmount || paidAmount !== expectedAmount) {
      console.error('❌ 金额不匹配', {
        expected: expectedAmount,
        actual: paidAmount
      });
      return res.status(400).send('amount mismatch');
    }

    /*----------- 幂等 ------------*/
    if (order.status === 'paid')
      return res.status(200).send('success');

    /*----------- 更新订单 ------------*/
    order.status = 'paid';
    // 🔥 删除 expireAt 字段，保证 TTL 不删除 paid
    order.expireAt = undefined;
    order.paidAt = new Date();
    order.payMethod = orderInfo.method || '';
    order.rawCallback = req.body;

    await order.save();

    console.log('✅ 游戏订单支付成功:', order._id.toString());

    return res.status(200).send('success');

  } catch (err) {
    console.error('❌ 支付回调失败:', err.message);
    return res.status(500).send('error');
  }
});


/*----------- 🔍 查询订单状态 ------------*/
router.get('/status/:orderId', auth, async (req, res) => {
  try {
    const { orderId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(orderId))
      return res.status(400).json({ message: '无效的订单ID' });

    const order = await Order.findOne({
      _id: orderId,
      userId: req.user.id
    });

    if (!order)
      return res.status(404).json({ message: '订单不存在' });

    res.json({ status: order.status });

  } catch (err) {
    console.error('❌ 查询订单状态失败:', err.message);
    res.status(500).json({ message: '服务器错误' });
  }
});


/*----------- 💰 查询是否已购买 ------------*/
router.get('/has-paid/:gameId', auth, async (req, res) => {
  try {
    const { gameId } = req.params;

    if (!gameId)
      return res.status(400).json({ message: '游戏ID不能为空' });

    const order = await Order.findOne({
      userId: req.user.id,
      gameId,
      status: 'paid'
    });

    res.json({ purchased: !!order });

  } catch (err) {
    console.error('❌ 查询购买状态失败:', err.message);
    res.status(500).json({ message: '服务器错误' });
  }
});

console.log('🎮 Order 路由加载版本: V15_TTL_SAFE');
module.exports = router;