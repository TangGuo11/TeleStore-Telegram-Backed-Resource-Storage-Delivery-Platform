// server-sd.js - 在原有基础上添加本地活跃度统计
const express = require('express');
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const axios = require('axios');
const statsRoutes = require('./routes/stats-users');
const app = express();

/*----- 域名文件访问权 --------*/
const DOMAIN_DIR = process.env.DOMAIN_DIR || path.join(__dirname, '../cloudflared');
app.use('/data', express.static(DOMAIN_DIR));

app.get('/data/current-domain.txt', (req, res, next) => {
  console.log('📩 收到读取 current-domain.txt 的请求');
  const filePath = path.join(DOMAIN_DIR, 'current-domain.txt');
  if (!fs.existsSync(filePath)) {
    return res.status(404).type('text/plain').send('❌ current-domain.txt 不存在');
  }
  return res.sendFile(filePath);
});

app.get('/data/game-domain.txt', (req, res) => {
  console.log('📩 收到读取 game-domain.txt 的请求');
  const filePath = path.join(DOMAIN_DIR, 'game-domain.txt');
  if (!fs.existsSync(filePath)) {
    return res.status(404).type('text/plain').send('❌ game-domain.txt 不存在');
  }
  return res.sendFile(filePath);
});

/*----- 🎯 新增：本地活跃度统计 --------*/
try {
  const activityRoutes = require('./activity');
  app.use('/api/activity-local', activityRoutes); // 使用不同路径避免冲突
  console.log('✅ 本地活跃度统计已加载');
} catch (err) {
  console.log('⚠️ 本地活跃度统计加载失败，但不影响其他功能:', err.message);
}

/*----- 使用本地活跃度统计 --------*/
const activityRoutes = require('./activity');
app.use('/api/activity', activityRoutes);


/*-------- 数据库连接 --------*/
const MONGO_URI = process.env.USER_DB_URI;
if (!MONGO_URI) throw new Error('USER_DB_URI is not set');
const PORT = process.env.PORT || 8087;

(async () => {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('✅ MongoDB connected');

    const User = require('./models/User');
    const count = await User.estimatedDocumentCount().catch(e => {
      console.error('⚠️ 自检查询失败:', e);
      return null;
    });
    console.log('👀 用户总量:', count);

    app.use(express.json());
    app.use('/api/stats', statsRoutes);
    app.use(express.static('public'));

    app.get('/api/today-ipv6', (req, res) => {
      const logPath = process.env.IPV6_LOG_PATH || path.join(__dirname, '../ipv6-log.txt');
      if (!fs.existsSync(logPath)) return res.send('📭 没有找到日志');

      const lines = fs.readFileSync(logPath, 'utf8').trim().split('\n');
      const today = new Date().toISOString().slice(0, 10);
      const todayLine = lines.find(line => line.includes(today));

      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      if (todayLine) {
        res.send(todayLine);
      } else {
        res.send('⚠️ 今天尚未绑定 IPv6');
      }
    });

    app.get('/health', (req, res) => {
      res.json({ 
        status: 'ok', 
        service: 'yh.zylm.my', 
        timestamp: new Date().toISOString() 
      });
    });

    app.listen(PORT, () => {
      console.log(`✅ Server running at http://localhost:${PORT}`);
      console.log(`📊 新增接口: /api/activity-local/* (本地活跃度统计)`);
    });
  } catch (err) {
    console.error('❌ 启动失败:', err);
    process.exit(1);
  }
})();