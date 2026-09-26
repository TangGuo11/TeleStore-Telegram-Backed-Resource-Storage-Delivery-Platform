// tools/manual-media-saver.js
const fs = require('fs');
const path = require('path');
const { getCacheFileName } = require('./file/utils');
const { DB_CACHE_MAP, CACHE_DIR } = require('./file/config');

class ManualMediaSaver {
  /*------------------ 保存作品缩略图 --------------------*/
  async saveWorkThumbnail(thumbFileId, imageBufferOrPath) {
    return await this.saveMedia(
      thumbFileId, 
      imageBufferOrPath, 
      'yyDB',           // 作品数据库
      'thumbnail',      // 文件类型
      'thumb',          // uniqueId
      '.jpg'            // 扩展名
    );
  }

  /*------------------ 保存作品图片 --------------------*/
  async saveWorkPhoto(photoFileId, imageBufferOrPath) {
    return await this.saveMedia(
      photoFileId,
      imageBufferOrPath,
      'yyDB',           // 作品数据库  
      'photo',          // 文件类型
      'cached',         // uniqueId
      '.jpg'            // 扩展名
    );
  }

  /*------------------ 通用保存方法 --------------------*/
  async saveMedia(fileId, imageBufferOrPath, dbName, fileType, uniqueId, extension) {
    try {
      // 生成标准文件名
      const savePath = getCacheFileName(fileId, uniqueId, extension, dbName, fileType);
      
      console.log(`📁 目标路径: ${savePath}`);
      
      // 确保目录存在
      const dir = path.dirname(savePath);
      await fs.promises.mkdir(dir, { recursive: true });
      
      let buffer;
      if (typeof imageBufferOrPath === 'string') {
        // 如果是文件路径，读取文件
        console.log(`📖 读取文件: ${imageBufferOrPath}`);
        buffer = await fs.promises.readFile(imageBufferOrPath);
      } else {
        // 如果是Buffer，直接使用
        buffer = imageBufferOrPath;
      }
      
      // 保存文件
      await fs.promises.writeFile(savePath, buffer);
      
      console.log(`✅ 保存成功: ${path.basename(savePath)}`);
      console.log(`📊 文件大小: ${(buffer.length / 1024).toFixed(2)} KB`);
      
      return savePath;
    } catch (error) {
      console.error(`❌ 保存失败: ${error.message}`);
      return null;
    }
  }

  /*------------------ 批量保存缩略图 --------------------*/
  async batchSaveThumbnails(thumbnailList) {
    const results = {
      success: 0,
      failed: 0,
      details: []
    };

    console.log(`🔄 开始批量保存 ${thumbnailList.length} 个缩略图...`);

    for (let i = 0; i < thumbnailList.length; i++) {
      const item = thumbnailList[i];
      const { thumbFileId, imagePath, imageBuffer } = item;
      
      const source = imagePath || 'buffer';
      console.log(`\n[${i + 1}/${thumbnailList.length}] 处理: ${thumbFileId.substring(0, 20)}... (来源: ${source})`);
      
      const result = await this.saveWorkThumbnail(
        thumbFileId, 
        imagePath || imageBuffer
      );
      
      if (result) {
        results.success++;
        results.details.push({ 
          thumbFileId, 
          status: 'success', 
          path: result,
          source: source
        });
      } else {
        results.failed++;
        results.details.push({ 
          thumbFileId, 
          status: 'failed',
          source: source
        });
      }
      // 避免处理过快
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    console.log(`\n🎉 批量保存完成:`);
    console.log(`✅ 成功: ${results.success} 个`);
    console.log(`❌ 失败: ${results.failed} 个`);
    
    return results;
  }



  /*------------------ 批量保存图片 --------------------*/
  async batchSavePhotos(photoList) {
    const results = {
      success: 0,
      failed: 0,
      details: []
    };

    console.log(`🔄 开始批量保存 ${photoList.length} 个图片...`);

    for (let i = 0; i < photoList.length; i++) {
      const item = photoList[i];
      const { fileId, imagePath, imageBuffer } = item;
      
      const source = imagePath || 'buffer';
      console.log(`\n[${i + 1}/${photoList.length}] 处理图片: ${fileId.substring(0, 20)}... (来源: ${source})`);
      
      const result = await this.saveWorkPhoto(
        fileId, 
        imagePath || imageBuffer
      );
      
      if (result) {
        results.success++;
        results.details.push({ 
          fileId, 
          status: 'success', 
          path: result,
          source: source
        });
      } else {
        results.failed++;
        results.details.push({ 
          fileId, 
          status: 'failed',
          source: source
        });
      }

      // 避免处理过快
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    console.log(`\n🎉 图片批量保存完成:`);
    console.log(`✅ 成功: ${results.success} 个`);
    console.log(`❌ 失败: ${results.failed} 个`);
    
    return results;
  }


  /*------------------ 验证文件是否可访问 --------------------*/
  async verifyThumbnail(thumbFileId) {
    const testPath = getCacheFileName(thumbFileId, 'thumb', '.jpg', 'yyDB', 'thumbnail');
    const exists = fs.existsSync(testPath);
    
    if (exists) {
      const stats = fs.statSync(testPath);
      console.log(`✅ 文件可访问: ${path.basename(testPath)}`);
      console.log(`📏 文件大小: ${(stats.size / 1024).toFixed(2)} KB`);
      console.log(`📁 完整路径: ${testPath}`);
      return { exists: true, path: testPath, size: stats.size };
    } else {
      console.log(`❌ 文件不存在: ${path.basename(testPath)}`);
      console.log(`📁 预期路径: ${testPath}`);
      return { exists: false, path: testPath };
    }
  }

  /*------------------ 列出已保存的缩略图 --------------------*/
  async listSavedThumbnails() {
    const worksPhotoDir = path.join(CACHE_DIR, 'works', 'photo');
    
    if (!fs.existsSync(worksPhotoDir)) {
      console.log('📁 作品缩略图目录不存在');
      return [];
    }

    try {
      const files = await fs.promises.readdir(worksPhotoDir);
      const thumbnails = files.filter(file => file.includes('_thumb.jpg'));
      
      console.log(`📁 找到 ${thumbnails.length} 个缩略图:`);
      thumbnails.forEach((file, index) => {
        const filePath = path.join(worksPhotoDir, file);
        const stats = fs.statSync(filePath);
        console.log(`  ${index + 1}. ${file} (${(stats.size / 1024).toFixed(1)} KB)`);
      });
      
      return thumbnails;
    } catch (error) {
      console.error(`❌ 读取目录失败: ${error.message}`);
      return [];
    }
  }
}

module.exports = ManualMediaSaver;
