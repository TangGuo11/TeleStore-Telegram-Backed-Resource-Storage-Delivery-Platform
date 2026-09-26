// 用户监听心跳 通用脚本
// 作用详细说明：💓 前端脚本，在浏览器里跑，定时告诉后端"我还在" 就像每隔 1 分钟发个微信消息："我还在线，别以为我掉线了"

function sendActivityPing(isUnload = false) {
  const currentPath = window.location.pathname;
  const currentReferrer = document.referrer || '';
  
  // 🎯 如果是页面卸载，使用 FormData + sendBeacon
  if (isUnload) {
    const formData = new FormData();
    formData.append('path', currentPath);
    formData.append('referrer', currentReferrer);
    formData.append('ts', Date.now().toString());
    
    const success = navigator.sendBeacon('/api/activity/ping', formData);
    console.log('📤 发送卸载心跳:', success ? '成功' : '失败');
    return;
  }
  
  // 🎯 正常心跳使用 JSON + fetch
  fetch('/api/activity/ping', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      path: currentPath,
      referrer: currentReferrer,
      ts: Date.now(),
      isPageUnload: false
    })
  }).then(response => {
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return response.json();
  }).then(data => {
    if (data.visitorId) {
      // 存储 visitorId 供后续使用
      localStorage.setItem('visitorId', data.visitorId);
    }
  }).catch(err => {
    console.log('心跳发送失败:', err);
  });
}

// 页面加载时立即打点
document.addEventListener('DOMContentLoaded', function() {
  setTimeout(() => sendActivityPing(false), 100); // 延迟100ms确保页面完全加载
});

// 页面可见性变化时发送心跳（切换标签页回来时）
document.addEventListener('visibilitychange', function() {
  if (!document.hidden) {
    sendActivityPing(false);
  }
});

// 页面关闭前发送最后一次心跳
window.addEventListener('beforeunload', function() {
  sendActivityPing(true); // 使用 FormData + sendBeacon
});

// 单页应用路由变化监听（如果有的话）
if (typeof window.history !== 'undefined') {
  const originalPushState = window.history.pushState;
  const originalReplaceState = window.history.replaceState;
  
  window.history.pushState = function(...args) {
    originalPushState.apply(this, args);
    // 延迟发送，确保路由已更新
    setTimeout(() => sendActivityPing(false), 50);
  };
  
  window.history.replaceState = function(...args) {
    originalReplaceState.apply(this, args);
    setTimeout(() => sendActivityPing(false), 50);
  };
  
  window.addEventListener('popstate', function() {
    setTimeout(() => sendActivityPing(false), 50);
  });
}

// 每隔 10 分钟打点一次（防止 30 分钟超时下线）
setInterval(() => sendActivityPing(false), 10 * 60 * 1000);

// 导出函数供其他模块使用（如果需要）
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { sendActivityPing };
}