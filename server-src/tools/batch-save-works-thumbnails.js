//batch-save-works-thumbnails.js
const ManualMediaSaver = require('./manual-media-saver');
const fs = require('fs');
const path = require('path');

// 图片文件与thumb_file_id的映射关系
const THUMBNAIL_MAPPINGS = [
  {
    thumbFileId: 'AAMCBQADIQUABIrV8FwAA8VpC3w-AXBib5VQcgdxcKQXyo-hyQAC9xoAAsCzUVfFIdCA3SZgLQEAB20AAzYE',
    imageFile: '1.jpg'
  },
  {
    thumbFileId: 'AAMCBQADIQUABIrV8FwAA8Zo6fOtFph6wS_ndZZjv_-NguE_RwAC-BoAAsCzUVdkhOezEQsmogEAB20AAzYE',
    imageFile: '2.jpg'
  },
  {
    thumbFileId: 'AAMCBQADIQUABIrV8FwAA8dpC3ngi63M7JntBr5xJLohWvRxJgAC-RoAAsCzUVeoDm-quklNNwEAB20AAzYE',
    imageFile: '3.jpg'
  },
  {
    thumbFileId: 'AAMCBQADIQUABIrV8FwAA81o6fndwuuXLsx9QeHsvBSut-Vi-QACEBsAAsCzUVfUWTu_SZs79gEAB20AAzYE',
    imageFile: '4.jpg'
  },

  {
    thumbFileId: 'AAMCBQADIQUABIrV8FwAA9Fo6hBiLI_FFBYe0x4OLWJ8GUp_3QACTBsAAsCzUVfOyvAxsLdHywEAB20AAzYE',
    imageFile: '5.jpg'
  },

  {
    thumbFileId: 'AAMCBQADIQUABIrV8FwAA9VpCLkB0CtVbsCBELVwZRyPbp38mAACYRsAAsCzUVeLkEZqlcI_KAEAB20AAzYE',
    imageFile: '6.jpg'
  },

  {
    thumbFileId: 'AAMCAQADIQUABIrV8FwAAgI8aQt1zCv5uVivdLi61n6tAfK6c_YAAnUFAAL1GDBE4xanXW0cPPMBAAdtAAM2BA',
    imageFile: '7.jpg'
  },

  {
    thumbFileId: 'AAMCBQADIQUABIrV8FwAAgJ3aQebdVhVtlO69nCk-dvqiOF0_dwAArgcAAKJrThUn1V2iTKP9JIBAAdtAAM2BA',
    imageFile: '8.jpg'
  },

];

class WorksThumbnailProcessor {
  constructor() {
    this.saver = new ManualMediaSaver();
    this.sourceDir = path.join(process.env.CACHE_DIR || path.join(process.cwd(), 'downloads'), 'works', 'photo') + path.sep;
  }

  /*------------------ 批量处理所有缩略图 --------------------*/
  async processAllThumbnails() {
    console.log('🚀 开始批量处理作品缩略图...\n');
    console.log(`📁 源目录: ${this.sourceDir}`);
    console.log(`📊 总共 ${THUMBNAIL_MAPPINGS.length} 个缩略图需要处理\n`);

    const results = {
      success: 0,
      failed: 0,
      details: []
    };

    for (let i = 0; i < THUMBNAIL_MAPPINGS.length; i++) {
      const mapping = THUMBNAIL_MAPPINGS[i];
      const sourcePath = path.join(this.sourceDir, mapping.imageFile);
      
      console.log(`\n[${i + 1}/${THUMBNAIL_MAPPINGS.length}] 处理: ${mapping.imageFile}`);
      console.log(`📝 thumb_file_id: ${mapping.thumbFileId.substring(0, 30)}...`);

      // 检查源文件是否存在
      if (!fs.existsSync(sourcePath)) {
        console.log(`❌ 源文件不存在: ${sourcePath}`);
        results.failed++;
        results.details.push({
          thumbFileId: mapping.thumbFileId,
          imageFile: mapping.imageFile,
          status: 'failed',
          reason: '源文件不存在'
        });
        continue;
      }

      try {
        // 保存缩略图
        const resultPath = await this.saver.saveWorkThumbnail(
          mapping.thumbFileId,
          sourcePath
        );

        if (resultPath) {
          console.log(`✅ 成功: ${mapping.imageFile} → ${path.basename(resultPath)}`);
          results.success++;
          results.details.push({
            thumbFileId: mapping.thumbFileId,
            imageFile: mapping.imageFile,
            status: 'success',
            savedPath: resultPath
          });
        } else {
          console.log(`❌ 失败: ${mapping.imageFile}`);
          results.failed++;
          results.details.push({
            thumbFileId: mapping.thumbFileId,
            imageFile: mapping.imageFile,
            status: 'failed',
            reason: '保存过程失败'
          });
        }
      } catch (error) {
        console.log(`❌ 异常: ${mapping.imageFile} - ${error.message}`);
        results.failed++;
        results.details.push({
          thumbFileId: mapping.thumbFileId,
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
    console.log('🎉 批量处理完成!');
    console.log('='.repeat(50));
    console.log(`✅ 成功: ${results.success} 个`);
    console.log(`❌ 失败: ${results.failed} 个`);
    console.log(`📊 总计: ${THUMBNAIL_MAPPINGS.length} 个`);

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

  /*------------------ 验证所有缩略图 --------------------*/
  async verifyAllThumbnails() {
    console.log('\n🔍 开始验证所有缩略图...\n');

    const verificationResults = [];

    for (const mapping of THUMBNAIL_MAPPINGS) {
      console.log(`验证: ${mapping.thumbFileId.substring(0, 30)}...`);
      
      const result = await this.saver.verifyThumbnail(mapping.thumbFileId);
      
      verificationResults.push({
        thumbFileId: mapping.thumbFileId,
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

  /*------------------ 生成映射关系报告 --------------------*/
  generateMappingReport(results) {
    const report = {
      generatedAt: new Date().toISOString(),
      totalProcessed: THUMBNAIL_MAPPINGS.length,
      successCount: results.success,
      failCount: results.failed,
      mappings: results.details.map(item => ({
        originalFile: item.imageFile,
        thumbFileId: item.thumbFileId,
        status: item.status,
        savedPath: item.savedPath || null,
        reason: item.reason || null
      }))
    };

    const reportPath = path.join(__dirname, 'works-thumbnails-mapping-report.json');
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    
    console.log(`\n📄 映射关系报告已保存: ${reportPath}`);
    return reportPath;
  }
}

/*------------------ 主执行函数 --------------------*/
async function main() {
  const processor = new WorksThumbnailProcessor();

  try {
    // 1. 批量处理所有缩略图
    const results = await processor.processAllThumbnails();

    // 2. 验证所有缩略图
    await processor.verifyAllThumbnails();

    // 3. 生成映射报告
    processor.generateMappingReport(results);

    console.log('\n🎊 所有操作完成! 作品缩略图已准备就绪。');
    console.log('\n💡 现在可以通过以下URL访问缩略图:');
    console.log('   http://你的域名/file/AAMCBQADIQUABIrV8FwAA31pBi2CtrG04B7EReztUrLjvQzDIAAC8xoAAoZW0Fa0jp-gw6tIrAEAB20AAzYE');
    console.log('   (将thumb_file_id替换为对应的ID)');

  } catch (error) {
    console.error('❌ 执行过程中出错:', error.message);
  }
}

// 运行主函数
if (require.main === module) {
  main().catch(console.error);
}

module.exports = WorksThumbnailProcessor;



