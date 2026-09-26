// orderController_fixed.js 

const Order = require("../models/Order");
const axios = require("axios");

const IDATARIVER_API = process.env.IDATARIVER_BASE_URL || "https://api.idatariver.com";
const AUTH_HEADER = { Authorization: `Bearer ${process.env.IDATARIVER_SECRET}` };


const SUPPORTED_PAY_METHODS = ["alipay", "wxpay"]; 
const createOrder = async (req, res) => {
  try {
    // 1. 校验登录
    const loginUserId = req.user?._id;
    if (!loginUserId) return res.status(401).json({ message: "请先登录后再创建订单" });
    console.log("👤 当前登录用户ID：", loginUserId);

    // 2. 解析参数（兼容 priceCNY / amount）
    const {
      priceCNY: priceCNYRaw,
      amount: amountRaw,
      subject = "",
      groupId,
    } = req.body;
    const priceCNY =
      typeof priceCNYRaw === "number" && priceCNYRaw > 0
        ? priceCNYRaw
        : typeof amountRaw === "number" && amountRaw > 0
        ? amountRaw
        : null;
    if (!priceCNY) return res.status(400).json({ message: "缺少 priceCNY/amount" });

    console.log("\n🧾 [STEP 0] 接收到 BUYMEABTC 订单请求");
    console.log("📦 请求体内容：", { priceCNY, subject });

    // 3. 获取 BUYMEABTC 项目
    console.log("\n🌐 [STEP 1] 请求项目列表接口：/mapi/project/list");
    const listRes = await axios.get(`${IDATARIVER_API}/mapi/project/list`, { headers: AUTH_HEADER });
    const targetProject = listRes.data?.result?.projects?.find((p) => p.type === "BUYMEABTC");
    if (!targetProject) throw new Error("未找到 BUYMEABTC 项目");
    const projectId = targetProject.id;
    console.log("📌 [STEP 2] 找到目标项目 ID：", projectId);

    // 4. 获取汇率 (临时订单)
    console.log("\n📌 [STEP 2.5] 创建临时订单以获取汇率");
    let exchangeRate = 0;
    try {
      const tmpOrderRes = await axios.post(
        `${IDATARIVER_API}/mapi/order/add`,
        { projectId, orderInfo: { amount: 1, private: false, name: "tmp", message: "tmp" } },
        { headers: { ...AUTH_HEADER, "Content-Type": "application/json" } }
      );
      const tmpOrderId = tmpOrderRes.data?.result?.orderId;
      const infoRes = await axios.get(`${IDATARIVER_API}/mapi/order/info`, {
        params: { id: tmpOrderId },
        headers: AUTH_HEADER,
      });
      const alipayRateObj = infoRes.data?.result?.mPayments?.find((p) => p.method === "alipay");
      const match = alipayRateObj?.desc?.match(/([\d.]+)CNY/);
      if (match) exchangeRate = parseFloat(match[1]);
    } catch {}
    if (!exchangeRate) return res.status(500).json({ error: "无法获取汇率" });
const rawUSD = priceCNY / exchangeRate;
const priceUSD = Math.ceil(rawUSD * 100) / 100;
console.log(`💱 人民币 ¥${priceCNY} 使用汇率 ${exchangeRate} 向上转换为美元 $${priceUSD}`);


    // 5. 创建正式订单
    console.log("\n📤 [STEP 3] 创建正式订单");
    const addRes = await axios.post(
      `${IDATARIVER_API}/mapi/order/add`,
      { projectId, orderInfo: { amount: priceUSD, private: false, name: "", message:"" } },
      { headers: { ...AUTH_HEADER, "Content-Type": "application/json" } }
    );
    const orderId = addRes.data?.result?.orderId;
    console.log("✅ [STEP 4] 创建正式订单成功，订单号：", orderId);

    // 6. 获取支付方式列表（从 add 返回或 info 查询）
    let mPayments = addRes.data?.result?.mPayments?.filter((p) => p.enabled) || [];
    if (!mPayments.length) {
      const infoRes = await axios.get(`${IDATARIVER_API}/mapi/order/info`, {
        params: { id: orderId },
        headers: AUTH_HEADER,
      });
      mPayments = infoRes.data?.result?.mPayments?.filter((p) => p.enabled) || [];
    }
    if (!mPayments.length) throw new Error("订单未配置任何支付方式");

    // 7. 生成支付链接
    const payUrls = {};
    for (const { method } of mPayments) {
      // 可选白名单过滤
      if (SUPPORTED_PAY_METHODS.length && !SUPPORTED_PAY_METHODS.includes(method)) {
        console.warn(`⚠️ 跳过不在白名单的支付方式：${method}`);
        continue;
      }

      const payPayload = {
        id: orderId,
        method,
        callbackUrl: `${process.env.BASE_URL}/api/order/notify`,
        redirectUrl: `${process.env.BASE_URL}/public/download.html?orderId=${orderId}`,
      };

      console.log(`🔗 请求支付链接 (${method})，参数：`, payPayload);
      try {
        const payRes = await axios.post(`${IDATARIVER_API}/mapi/order/pay`, payPayload, { headers: AUTH_HEADER });
        const payUrl = payRes.data?.result?.payUrl;
        if (payUrl) payUrls[`${method}Url`] = payUrl;
        else console.warn(`⚠️ ${method} 未返回 payUrl，已跳过`);
      } catch (e) {
        console.warn(`⚠️ 获取 ${method} 支付链接失败：`, e.response?.data || e.message);
      }
    }

    if (!Object.keys(payUrls).length) throw new Error("未成功获取任何支付链接");

    // 8. 保存本地订单
    const localOrder = await Order.create({ orderId, productId: projectId, userId: loginUserId, groupId, status: "pending" });
    console.log("🗃️ 本地订单保存成功：", localOrder);

    return res.json({ orderId, ...payUrls });
  } catch (err) {
    console.error("\n❌ [ERROR] 创建 BUYMEABTC 订单失败");
    if (err.response) {
      console.error("📥 [响应错误] 状态码：", err.response.status);
      console.error("📥 [响应数据]：", JSON.stringify(err.response.data, null, 2));
    }
    console.error("📥 [错误信息]：", err.message);
    res.status(500).json({ error: err.message || "创建订单失败" });
  }
};

// ------ 支付回调 ------
const handleNotify = async (req, res) => {
  try {
    // 📬 打印回调数据（调试用，可保留）
    console.log("📬 收到支付回调：", req.body);

    // ✅ 从 result 中获取订单 ID
    const { result, event } = req.body;
    if (!result || !result.id) {
      return res.status(400).send("缺少订单ID");
    }

    // 如果不是订单完成事件可直接忽略
    if (event !== "ORDER_COMPLETED") {
      return res.status(200).send("无需处理");
    }

    const id = result.id;

    // 查询订单详情确认状态
    const infoRes = await axios.get(`${IDATARIVER_API}/mapi/order/info`, {
      params: { id },
      headers: AUTH_HEADER
    });
    const orderInfo = infoRes.data?.result;
    if (!orderInfo || orderInfo.status !== "DONE") {
      return res.status(200).send("无需处理");
    }

    // 更新本地数据库订单状态
    const order = await Order.findOne({ orderId: id });
    if (!order) return res.status(404).send("订单不存在");

    if (order.status !== "paid") {
      order.status = "paid";
      await order.save();
      console.log("✅ 订单状态已更新为 paid：", id);
    }

    res.status(200).send("success");
  } catch (err) {
    console.error("❌ 回调处理失败：", err.message);
    res.status(500).send("error");
  }
};

module.exports = { createOrder, handleNotify };
