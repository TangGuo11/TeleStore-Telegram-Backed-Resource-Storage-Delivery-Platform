// test-telegram-cleanup.js
// 手动测试 Telegram 清理任务

require('dotenv').config({ path: require('path').resolve(__dirname, '.env') });

const { manual } = require('./src/schedules/telegram');

async function testCleanup() {
    console.log('='.repeat(60));
    console.log('🧪 开始手动测试 Telegram 数据清理');
    console.log('='.repeat(60));
    
    const startTime = Date.now();
    
    try {
        // 测试1: 清理聊天历史数据
        console.log('\n📋 测试1: 清理聊天历史数据 (clearChatHistory)');
        console.log('-'.repeat(40));
        await manual.clearChatHistory();
        
        console.log('\n📋 测试2: 协调清理推送数据及缓存 (coordinateTelegramCleanup)');
        console.log('-'.repeat(40));
        await manual.coordinateTelegramCleanup();
        
        console.log('\n📋 测试3: 清理孤立缓存文件 (clearOrphanedCache)');
        console.log('-'.repeat(40));
        await manual.clearOrphanedCache();
        
        const duration = ((Date.now() - startTime) / 1000).toFixed(2);
        console.log('\n' + '='.repeat(60));
        console.log(`✅ 所有测试完成，总耗时: ${duration}秒`);
        console.log('='.repeat(60));
        
    } catch (error) {
        console.error('\n❌ 测试失败:', error);
        console.error('错误堆栈:', error.stack);
    }
    
    // 等待一下确保所有数据库连接关闭
    setTimeout(() => {
        process.exit(0);
    }, 2000);
}

// 运行测试
testCleanup().catch(console.error);