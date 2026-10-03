const MESSAGES = {
  lr_offline: 'Lightroom 未运行，或插件没有加载',
  lr_busy: 'Lightroom 正忙（可能开着对话框），请稍后再试',
  lr_timeout: 'Lightroom 响应超时，请稍后再试',
  photo_not_found: '这张照片已不在目录里',
  source_not_found: '这个文件夹或收藏夹已不存在',
  network: '连不上电脑，请检查网络和 Tailscale',
};

export const messageFor = (code) => MESSAGES[code] ?? '操作失败，请重试';
