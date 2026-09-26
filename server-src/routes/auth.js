const express = require('express');
const jwt = require('jsonwebtoken');
const dbManager = require('../../db/DBManager');

const router = express.Router();
const secret = process.env.JWT_SECRET;

let User; // 模型实例

// 懒加载模型
async function initModels() {
  if (!User) User = await dbManager.getModel('User');
}

/* ---------- 用户注册 ---------- */
router.post('/register', async (req, res) => {
  const { username, password } = req.body;

  try {
    await initModels();

    const existingUser = await User.findOne({ username });
    if (existingUser) return res.status(400).json({ message: '用户名已存在' });

    const user = new User({ username, password });
    await user.save();

    res.status(201).json({ message: '注册成功' });
  } catch (err) {
    console.error('注册失败:', err);
    res.status(500).json({ message: '服务器错误' });
  }
});

/* ---------- 用户登录 ---------- */
router.post('/login', async (req, res) => {
  const { username, password } = req.body;

  try {
    await initModels();

    const user = await User.findOne({ username });
    if (!user) return res.status(400).json({ message: '用户不存在' });
    if (user.password !== password) return res.status(400).json({ message: '密码错误' });

    const token = jwt.sign({ userId: user._id }, secret, { expiresIn: '7d' });

    res.cookie('token', token, {
      httpOnly: true,
      maxAge: 7 * 24 * 3600 * 1000,
      sameSite: 'lax',
      secure: true
    });

    res.status(200).json({
      message: '登录成功',
      user: {
        id: user._id,
        username: user.username,
        avatar: user.avatar || '',
        role: user.role || 'user'
      }
    });
  } catch (err) {
    console.error('登录失败:', err);
    res.status(500).json({ message: '服务器错误' });
  }
});

module.exports = router;
