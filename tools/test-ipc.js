/**
 * 直接测试 wechat-automation 模块
 */
const wechat = require('../src/main/modules/wechat-automation');

async function test() {
  console.log('=== Testing findWechatWindow ===');
  try {
    const result = await wechat.findWechatWindow();
    console.log('Result:', JSON.stringify(result, null, 2));
  } catch (e) {
    console.log('Error:', e.message);
  }
}

test();
