const jwt = require('jsonwebtoken');

module.exports = (req, res, next) => {

  const token = req.query.token;
  const cookieToken = req.cookies?.token;

  // 如果已有 cookie，先验证；过期/无效则允许用 query token 续上
  if (cookieToken) {
    try {
      jwt.verify(cookieToken, process.env.JWT_SECRET);
      return next();
    } catch (err) {
      // 清理掉过期/无效 cookie，避免一直卡在 jwt expired
      res.clearCookie('token');
    }
  }

  if (!token) return next();

  try {
    // 验证来自3000的JWT
    jwt.verify(token, process.env.JWT_SECRET);

    // 兼容 Cloudflare / 反向代理的 https 判断
    const proto = (req.headers['x-forwarded-proto'] || '').toString().toLowerCase();
    const isSecure = req.secure || proto === 'https';

    // ⭐ 写入商城自己的cookie
    res.cookie('token', token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: isSecure,
      maxAge: 7 * 24 * 3600 * 1000
    });

    console.log('✅ SSO 自动登录成功');

    // 清理URL
    const cleanUrl = req.originalUrl.split('?')[0];
    return res.redirect(cleanUrl);

  } catch (err) {
    console.log('❌ SSO token 无效');
    return next();
  }
};