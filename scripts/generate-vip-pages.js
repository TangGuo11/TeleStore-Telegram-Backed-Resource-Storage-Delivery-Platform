const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '../public/yy.html'), 'utf8');
const fetchOld = `const response = await fetch('/api/feeds', {
                    headers: { 'from': 'work' }
                });`;

for (let i = 1; i <= 5; i++) {
  const fetchNew = `const response = await fetch('/api/feeds?category=${i}', {
                    headers: { 'from': 'member' }
                });`;

  const content = src
    .replace('<title>🧘悠悠</title>', `<title>⭐会员分类内容${i}</title>`)
    .replace(fetchOld, fetchNew)
    .replace('[前端] 正在请求作品数据...', `[前端] 正在请求会员分类${i}数据...`);

  fs.writeFileSync(path.join(__dirname, `../public/vip${i}.html`), content, 'utf8');
  console.log(`Created vip${i}.html`);
}
