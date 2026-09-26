// tools/batch-save-works-photos.js
const ManualMediaSaver = require('./manual-media-saver');
const fs = require('fs');
const path = require('path');

// 图片文件与file_id的映射关系
const PHOTO_MAPPINGS = [
  {
    fileId: 'AgACAgUAAyEFAASK1fBcAAOOaQdEhc1WCT72nPuFON6EcOR3JUsAAtsLaxtIEClXjS6MZRkFe48BAAMCAAN5AAM2BA',
    imageFile: '1.jpg' 
  },
  
  {
    fileId: 'AgACAgUAAyEFAASK1fBcAAOoaQiXvn263G6LT-b15d2a4Cxv1XEAAgELaxtDCEhXKYPofhqIMpQBAAMCAAN4AAM2BA',
    imageFile: '2.jpg' 
  },

  {
    fileId: 'AgACAgUAAyEFAASK1fBcAAO0aQg8crkvXNHXaJPlwINofYScPLgAAggLaxtDCEhXMPL8uRVCB_cBAAMCAAN4AAM2BA',
    imageFile: '3.jpg' 
  },

  {
    fileId: 'AgACAgUAAyEFAASK1fBcAAO8aQg8b1T-iarsQUr5Y_IpFF5izpAAAsYLaxtDCEhXtW5fh-Ey3twBAAMCAAN5AAM2BA',
    imageFile: '4.jpg' 
  },

  {
    fileId: 'AgACAgUAAyEFAASK1fBcAAPAaQg8bKTpQZeil-RUBP4IB6fUEocAAi0LaxvAs1FXD0tELlSALqcBAAMCAAN5AAM2BA',
    imageFile: '5.jpg' 
  },

  {
    fileId: 'AgACAgUAAyEFAASK1fBcAAPEaQg8aTjoqkTVRo-hdawm3E0AAbsHAAJJC2sbwLNRVyA0MMqcoZvVAQADAgADeQADNgQ',
    imageFile: '6.jpg' 
  },

  {
    fileId: 'AgACAgUAAyEFAASK1fBcAAPMaQg8Z7oGKsRuggukFjVwOW9xn_kAAlELaxvAs1FXKfoCG0cV9mUBAAMCAAN5AAM2BA',
    imageFile: '7.jpg' 
  },

  {
    fileId: 'AgACAgUAAyEFAASK1fBcAAPQaQg8YfpSK4bMmnv2i8Ct5x184vUAAqsLaxvAs1FX0fBaL13TzpgBAAMCAAN5AAM2BA',
    imageFile: '8.jpg' 
  },

  {
    fileId: 'AgACAgUAAyEFAASK1fBcAAPUaQg8YUxrRHKgVleLtPhq1qRwb1oAAuMLaxvAs1FXOI_yR6G_MCkBAAMCAAN5AAM2BA',
    imageFile: '9.jpg' 
  } 
];

class WorksPhotoProcessor {
  constructor() {
    this.saver = new ManualMediaSaver();
    this.sourceDir = path.join(process.env.CACHE_DIR || path.join(process.cwd(), 'downloads'), 'works', 'photo') + path.sep;
  }

  /*------------------ 批量处理所有图片 --------------------*/
  async processAllPhotos() {
    console.log('🚀 开始批量处理作品图片...\n');
    console.log(`📁 源目录: ${this.sourceDir}`);
    console.log(`📊 总共 ${PHOTO_MAPPINGS.length} 个图片需要处理\n`);

    const results = {
      success: 0,
      failed: 0,
      details: []
    };

    for (let i = 0; i < PHOTO_MAPPINGS.length; i++) {
      const mapping = PHOTO_MAPPINGS[i];
      const sourcePath = path.join(this.sourceDir, mapping.imageFile);
      
      console.log(`\n[${i + 1}/${PHOTO_MAPPINGS.length}] 处理: ${mapping.imageFile}`);
      console.log(`📝 file_id: ${mapping.fileId.substring(0, 30)}...`);

      // 检查源文件是否存在
      if (!fs.existsSync(sourcePath)) {
        console.log(`❌ 源文件不存在: ${sourcePath}`);
        results.failed++;
        results.details.push({
          fileId: mapping.fileId,
          imageFile: mapping.imageFile,
          status: 'failed',
          reason: '源文件不存在'
        });
        continue;
      }

      try {
        // 保存图片
        const resultPath = await this.saver.saveWorkPhoto(
          mapping.fileId,
          sourcePath
        );

        if (resultPath) {
          console.log(`✅ 成功: ${mapping.imageFile} → ${path.basename(resultPath)}`);
          results.success++;
          results.details.push({
            fileId: mapping.fileId,
            imageFile: mapping.imageFile,
            status: 'success',
            savedPath: resultPath
          });
        } else {
          console.log(`❌ 失败: ${mapping.imageFile}`);
          results.failed++;
          results.details.push({
            fileId: mapping.fileId,
            imageFile: mapping.imageFile,
            status: 'failed',
            reason: '保存过程失败'
          });
        }
      } catch (error) {
        console.log(`❌ 异常: ${mapping.imageFile} - ${error.message}`);
        results.failed++;
        results.details.push({
          fileId: mapping.fileId,
          imageFile: mapping.imageFile,
          status: 'error',
          reason: error.message
        });
      }

      // 短暂延迟，避免处理过快
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    return this.printResults(results);
  }

  /*------------------ 打印处理结果 --------------------*/
  printResults(results) {
    console.log('\n' + '='.repeat(50));
    console.log('🎉 图片批量处理完成!');
    console.log('='.repeat(50));
    console.log(`✅ 成功: ${results.success} 个`);
    console.log(`❌ 失败: ${results.failed} 个`);
    console.log(`📊 总计: ${PHOTO_MAPPINGS.length} 个`);

    if (results.failed > 0) {
      console.log('\n📋 失败详情:');
      results.details
        .filter(item => item.status !== 'success')
        .forEach(item => {
          console.log(`   ❌ ${item.imageFile}: ${item.reason}`);
        });
    }

    console.log('\n📋 成功文件映射:');
    results.details
      .filter(item => item.status === 'success')
      .forEach(item => {
        console.log(`   ✅ ${item.imageFile} → ${path.basename(item.savedPath)}`);
      });

    return results;
  }

  /*------------------ 验证所有图片 --------------------*/
  async verifyAllPhotos() {
    console.log('\n🔍 开始验证所有图片...\n');

    const verificationResults = [];

    for (const mapping of PHOTO_MAPPINGS) {
      console.log(`验证: ${mapping.fileId.substring(0, 30)}...`);
      
      const result = await this.saver.verifyPhoto(mapping.fileId);
      
      verificationResults.push({
        fileId: mapping.fileId,
        imageFile: mapping.imageFile,
        ...result
      });

      await new Promise(resolve => setTimeout(resolve, 100));
    }

    console.log('\n📊 验证结果汇总:');
    const accessible = verificationResults.filter(r => r.exists).length;
    const inaccessible = verificationResults.filter(r => !r.exists).length;
    
    console.log(`✅ 可访问: ${accessible} 个`);
    console.log(`❌ 不可访问: ${inaccessible} 个`);

    return verificationResults;
  }
}

/*------------------ 主执行函数 --------------------*/
async function main() {
  const processor = new WorksPhotoProcessor();

  try {
    // 1. 批量处理所有图片
    const results = await processor.processAllPhotos();

    // 2. 验证所有图片
    await processor.verifyAllPhotos();

    console.log('\n🎊 所有操作完成! 作品图片已准备就绪。');
    console.log('\n💡 现在可以通过以下URL访问图片:');
    console.log('   http://你的域名/file/AgACAgUAAyEFAASK1fBcAAN8aQiXviEZ-s_v8K5h2iCKR7HPlAwAAmHKMRuGVtBWGRayLTeN5U0BAAMCAAN5AAM2BA');
    console.log('   (将file_id替换为对应的ID)');

  } catch (error) {
    console.error('❌ 执行过程中出错:', error.message);
  }
}

// 运行主函数
if (require.main === module) {
  main().catch(console.error);
}

module.exports = WorksPhotoProcessor;



