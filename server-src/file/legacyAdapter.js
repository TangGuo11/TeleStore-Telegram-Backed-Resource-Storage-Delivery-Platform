// file/legacyAdapter.js
const FileController = require('./FileController');

let fileController = null;

module.exports = {
  init(dbManager) {
    fileController = new FileController(dbManager);
    console.log('✅ FileController 初始化完成');
    return this;
  },

  getController() {
    return fileController;
  },

  // 🎯 只暴露核心方法
  handleFileRequest(req, res) {
    if (!fileController) {
      return res.status(503).send('文件处理器未初始化');
    }
    return fileController.handleFileRequest(req, res);
  }
};