// zylm-my.js
const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

require('dotenv').config({ path: path.resolve(__dirname, '.env') });

const app = express();
const PORT = process.env.ZYLM_MY_PORT || 8086;

// Enable CORS
app.use(cors());

/*----- home page -----*/
app.get('/', (req, res) => {
  const indexFile = path.join(process.env.PUBLIC_DIR || path.join(__dirname, 'public'), 'zylm.my.html');
  if (fs.existsSync(indexFile)) {
    res.sendFile(indexFile);
  } else {
    res.status(404).send('❌ 首页文件不存在');
  }
});


// 安全读取 current-domain.txt
app.get('/data/current-domain.txt', (req, res) => {
  const filePath = path.join(process.env.DOMAIN_DIR || path.join(__dirname, 'cloudflared'), 'current-domain.txt');

  console.log('[zylm-my] 请求 current-domain.txt');

  try {
    if (!fs.existsSync(filePath)) {
      console.warn('[zylm-my] 文件不存在:', filePath);
      return res.status(404).type('text/plain').send('❌ 文件不存在');
    }

    const content = fs.readFileSync(filePath, 'utf8').trim();
    console.log('[zylm-my] 文件内容：', content);
    res.type('text/plain').send(content || '❌ 文件为空');
  } catch (err) {
    console.error('[zylm-my] 读取文件失败:', err);
    res.status(500).type('text/plain').send('❌ 内部错误');
  }
});

// ----------------------
// 启动服务
// ----------------------
app.listen(PORT, () => {
  console.log(`✅ zylm-my server running at http://localhost:${PORT}`);
});
