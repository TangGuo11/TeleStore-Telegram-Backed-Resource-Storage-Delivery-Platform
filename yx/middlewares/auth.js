const jwt = require('jsonwebtoken');

module.exports = (req, res, next) => {
  const token = req.cookies?.token;

  if (!token) {
    return res.status(401).json({ message: '未登录' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // ✅ 只放最小必要信息
    req.user = {
      id: decoded.userId
    };

    next();
  } catch (err) {
    console.error('❌ auth 校验失败:', err.message);
    return res.status(401).json({ message: '无效 token' });
  }
};
