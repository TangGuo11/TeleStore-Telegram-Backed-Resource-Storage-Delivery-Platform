// game-api/db/mongoose.js
const mongoose = require('mongoose');

class DatabaseManager {
  constructor() {
    this.connected = false;
    this.connecting = false;

    this.gameConnection = null; // 默认游戏数据库

    mongoose.set('strictQuery', true);

    /* ===================== 默认（游戏库）监听 ===================== */
    mongoose.connection.on('connected', () => {
      console.log('✅ 游戏数据库连接成功');
      this.connected = true;
    });

    mongoose.connection.on('error', (err) => {
      console.error('❌ 游戏数据库连接错误:', err.message);
      this.connected = false;
    });

    mongoose.connection.on('disconnected', () => {
      console.log('⚠️ 游戏数据库连接断开');
      this.connected = false;
    });
  }

  /* ================================================================
     游戏数据库（默认连接，兼容 Game.js）
  ================================================================= */
  async connect() {
    if (this.connected || this.connecting) {
      return mongoose.connection;
    }

    this.connecting = true;

    try {
      const uri = process.env.MONGO_URL;
      if (!uri) throw new Error('MONGO_URL 未设置');

      console.log('🎮 连接游戏数据库...');
      console.log('🔐 URI:', this.maskUri(uri));

      await mongoose.connect(uri, {
        serverSelectionTimeoutMS: 10000,
        socketTimeoutMS: 45000,
        maxPoolSize: 10,
        minPoolSize: 2
      });

      this.gameConnection = mongoose.connection;

      console.log('✅ 游戏数据库连接就绪');
      return this.gameConnection;

    } catch (err) {
      console.error('❌ 游戏数据库连接失败:', err.message);
      throw err;
    } finally {
      this.connecting = false;
    }
  }

  /* ================================================================
     状态检查
  ================================================================= */
  isConnected() {
    return mongoose.connection.readyState === 1 && this.connected === true;
  }

  getGameConnection() {
    return mongoose.connection;
  }

  /* ================================================================
     优雅关闭
  ================================================================= */
  async disconnect() {
    console.log('🔌 正在关闭游戏数据库连接...');

    if (mongoose.connection.readyState === 1) {
      await mongoose.disconnect();
    }

    console.log('✅ 游戏数据库连接已关闭');
  }

  /* ================================================================
     工具方法
  ================================================================= */
  maskUri(uri) {
    return uri.replace(/\/\/([^:]+):([^@]+)@/, '//***:***@');
  }
}

/* ===================== 单例 ===================== */
const dbManager = new DatabaseManager();

module.exports = {
  dbManager,
  mongoose, // 保留默认 mongoose（Game 使用）
  connect: () => dbManager.connect(),
  isConnected: () => dbManager.isConnected(),
  disconnect: () => dbManager.disconnect(),
  getGameConnection: () => dbManager.getGameConnection()
};
