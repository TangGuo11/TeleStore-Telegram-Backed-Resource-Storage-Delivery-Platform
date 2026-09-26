const express = require('express');
const jwt = require('jsonwebtoken');
const dbManager = require('../../db/DBManager');

const router = express.Router();

let User; // 模型实例

// 懒加载模型
async function initModels() {
  if (!User) User = await dbManager.getModel('User');
}

/*------------- 用于登录判断 ----------*/
router.get('/me', async (req, res) => {
  const token = req.cookies.token;
  if (!token) return res.status(401).json({ message: '未登录' });

  try {
    // 确保模型已初始化
    await initModels();

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.userId).lean();
    if (!user) return res.status(404).json({ message: '用户不存在' });

    res.json({
      id: user._id,
      username: user.username,
      avatar: user.avatar || '',
      role: user.role || 'user'
    });
  } catch (err) {
    console.error('❌ /api/me 失败:', err);
    res.status(401).json({ message: '无效 token' });
  }
});

module.exports = router;
