const express = require('express');
const fs = require('fs');
const path = require('path');
const mime = require('mime-types');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });

const app = express();
const PORT = process.env.PROXY_FILE_PORT || 8088;

const BOT_TOKEN = process.env.BOT_TOKEN || '';
const CACHE_DIR = process.env.CACHE_DIR || path.join(process.cwd(), 'downloads');
const BASE_DIR = path.join(CACHE_DIR, BOT_TOKEN);

app.get('/proxy-file', async (req, res) => {
  const relativePath = req.query.path;
  if (!relativePath) return res.status(400).send('Missing path');

  const fullPath = path.join(BASE_DIR, relativePath);

  // 防止目录穿越攻击
  if (!fullPath.startsWith(BASE_DIR)) {
    return res.status(403).send('Invalid path');
  }

  console.log(`📂 正在读取文件: ${fullPath}`);

  // 检查文件是否存在
  if (!fs.existsSync(fullPath)) {
    console.error('❌ 文件不存在');
    return res.status(404).send('File not found');
  }

  // 设置 MIME 类型
  const mimeType = mime.lookup(fullPath) || 'application/octet-stream';
  res.setHeader('Content-Type', mimeType);

  // 读取并流式返回
  const readStream = fs.createReadStream(fullPath);
  readStream.pipe(res);

  readStream.on('error', (err) => {
    console.error('❌ 读取文件失败:', err);
    res.status(500).send('Read error');
  });
});

app.listen(PORT, () => {
  console.log(`🚀 proxy-file.js 已启动，监听端口 ${PORT}`);
});