// utils/logger.js
class Logger {
  static info(message, meta = {}) {
    const timestamp = new Date().toISOString();
    console.log(`📌 ${timestamp} ${message}`, Object.keys(meta).length ? meta : '');
  }

  static error(message, error = {}) {
    const timestamp = new Date().toISOString();
    console.error(`❌ ${timestamp} ${message}`, error.message || error);
  }

  static warn(message, meta = {}) {
    const timestamp = new Date().toISOString();
    console.warn(`⚠️ ${timestamp} ${message}`, Object.keys(meta).length ? meta : '');
  }

  static cache(message, fileId = '') {
    const timestamp = new Date().toISOString();
    console.log(`💾 ${timestamp} ${message}`, fileId ? { fileId } : '');
  }

  static db(message, dbName = '') {
    const timestamp = new Date().toISOString();
    console.log(`🗄️ ${timestamp} ${message}`, dbName ? { dbName } : '');
  }

  static bot(message, updateId = '') {
    const timestamp = new Date().toISOString();
    console.log(`🤖 ${timestamp} ${message}`, updateId ? { updateId } : '');
  }
}

module.exports = Logger;



