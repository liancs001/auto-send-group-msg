// 快速测试修复后的 findWechatWindow 和 activateWechat
const { findWechatWindow, activateWechat } = require('../src/main/modules/wechat-automation');

async function test() {
  console.log('=== 测试 findWechatWindow ===');
  const wnd = await findWechatWindow();
  console.log('结果:', JSON.stringify(wnd, null, 2));

  if (wnd.found) {
    console.log('\n=== 测试 activateWechat ===');
    const act = await activateWechat();
    console.log('结果:', JSON.stringify(act, null, 2));
  } else {
    console.log('\n❌ 未找到微信窗口，错误:', wnd.error);
  }
}

test().catch(console.error);
