// TDLight cache test script
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const axios = require('axios');

const token = process.env.BOT_TOKEN;
const tdlightBase = (process.env.TDLIGHT_URL || 'http://127.0.0.1:8081').replace(/\/$/, '');
const TDLIGHT_URL = `${tdlightBase}/bot${token}`;

async function cacheFile(fileId) {
  console.log('Request TDLight cache for file:', fileId);
  try {
    const res = await axios.get(`${TDLIGHT_URL}/getFile?file_id=${fileId}`, { timeout: 150000 });
    if (res.data.ok) {
      console.log('TDLight response:', res.data.result);
    } else {
      console.warn('TDLight unexpected response:', res.data);
    }
  } catch (err) {
    console.error('Request failed:', err.message);
  }
}

const FILE_ID = process.env.TEST_FILE_ID || 'replace-with-a-telegram-file-id';
cacheFile(FILE_ID);
