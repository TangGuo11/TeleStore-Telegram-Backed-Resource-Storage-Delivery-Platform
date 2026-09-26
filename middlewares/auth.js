// middlewares/auth.js  （用户验证 中间件 用于分支项目获取用户ID 和登录状态）
const jwt = require('jsonwebtoken');
const secret = process.env.JWT_SECRET; // ✅ 从 .env 读取
// 建议放入 .env 文件

function authMiddleware(req, res, next) {
  const token = req.cookies.token;

  if (token) {
    try {
      const decoded = jwt.verify(token, secret);
      req.user = { _id: decoded.userId };
    } catch (err) {
      req.user = null;
    }
  } else {
    req.user = null;
  }

  next();
}

module.exports = authMiddleware;








