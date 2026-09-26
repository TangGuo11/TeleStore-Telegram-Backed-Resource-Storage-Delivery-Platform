// yx/game-shop/services/idatariver.js
const axios = require('axios');

const BASE_URL = process.env.IDATARIVER_BASE_URL || 'https://api.idatariver.com';
const AUTH_HEADER = { Authorization: `Bearer ${process.env.IDATARIVER_SECRET}` };
const SUPPORTED_PAY_METHODS = ['alipay', 'wxpay'];

module.exports = {
  async createOrder({
    projectId,
    amountCNY,
    privateId,
    name,
    message,
    localOrderId,
    callbackUrl,
    redirectUrl
  }) {

    if (!projectId) throw new Error('缺少 projectId');
    if (!localOrderId) throw new Error('缺少 localOrderId');

    // 1️⃣ 获取汇率
    let exchangeRate = 0;
    try {
      const tmpOrderRes = await axios.post(
        `${BASE_URL}/mapi/order/add`,
        { projectId, orderInfo: { amount: 1, private: false, name: 'tmp', message: 'tmp' } },
        { headers: { ...AUTH_HEADER, 'Content-Type': 'application/json' } }
      );

      const tmpId = tmpOrderRes.data?.result?.orderId;

      const infoRes = await axios.get(
        `${BASE_URL}/mapi/order/info`,
        { params: { id: tmpId }, headers: AUTH_HEADER }
      );

      const alipayObj = infoRes.data?.result?.mPayments?.find(p => p.method === 'alipay');
      const match = alipayObj?.desc?.match(/([\d.]+)CNY/);
      if (match) exchangeRate = parseFloat(match[1]);
    } catch {}

    if (!exchangeRate) throw new Error('无法获取汇率');

    const priceUSD = Math.ceil((amountCNY / exchangeRate) * 100) / 100;

    // 2️⃣ 创建正式订单
    const addRes = await axios.post(
      `${BASE_URL}/mapi/order/add`,
      { projectId, orderInfo: { amount: priceUSD, private: false, name, message } },
      { headers: { ...AUTH_HEADER, 'Content-Type': 'application/json' } }
    );

    const orderId = addRes.data?.result?.orderId;
    if (!orderId) throw new Error('iDataRiver 未返回订单号');

    // 3️⃣ 获取支付方式
    let mPayments = addRes.data?.result?.mPayments?.filter(p => p.enabled) || [];

    if (!mPayments.length) {
      const infoRes = await axios.get(
        `${BASE_URL}/mapi/order/info`,
        { params: { id: orderId }, headers: AUTH_HEADER }
      );
      mPayments = infoRes.data?.result?.mPayments?.filter(p => p.enabled) || [];
    }

    if (!mPayments.length) throw new Error('订单未配置任何支付方式');

    // 4️⃣ 生成所有支持的支付链接
    const payUrls = {
      alipayUrl: '',
      wxpayUrl: ''
    };

    for (const { method } of mPayments) {

      if (!SUPPORTED_PAY_METHODS.includes(method)) {
        continue;
      }

      try {
        const payRes = await axios.post(
          `${BASE_URL}/mapi/order/pay`,
          {
            id: orderId,
            method,
            callbackUrl: callbackUrl || `${process.env.BASE_URL}/game-api/order/notify`,
            redirectUrl: redirectUrl || `${process.env.BASE_URL}/public/download.html?orderId=${localOrderId}`
          },
          { headers: AUTH_HEADER }
        );

        const url = payRes.data?.result?.payUrl;

        if (url) {
          if (method === 'alipay') payUrls.alipayUrl = url;
          if (method === 'wxpay') payUrls.wxpayUrl = url;
        }

      } catch (err) {
        console.warn(`⚠️ 获取 ${method} 支付链接失败`, err.message);
      }
    }

    if (!payUrls.alipayUrl && !payUrls.wxpayUrl) {
      throw new Error('未生成任何支付链接');
    }

    return {
      orderId,
      ...payUrls
    };
  }
};
