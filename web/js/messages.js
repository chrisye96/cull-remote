const MESSAGES = {
  lr_offline: 'Lightroom 未运行，或插件没有加载',
  lr_busy: 'Lightroom 正忙（可能开着对话框），请稍后再试',
  lr_timeout: 'Lightroom 响应超时，请稍后再试',
  photo_not_found: '这张照片已不在目录里',
  source_not_found: '这个文件夹或收藏夹已不存在',
  network: '连不上电脑，请检查网络和 Tailscale',
  plugin_error: 'Lightroom 插件出错，详情见插件日志',
  invalid_size: '预览尺寸无效',
  preview_timeout: '预览生成超时，请重试',
  bad_preview: '预览数据异常，请重试',
};

export const messageFor = (code) => MESSAGES[code] ?? '操作失败，请重试';

const SHORT = { network: '离线', lr_offline: 'Lightroom 未运行', lr_busy: 'Lightroom 正忙', lr_timeout: 'Lightroom 响应超时' };

// Text of the top status bar. `code` is '' while everything is reachable. With marks
// waiting, the bar says how many instead of how to fix the connection.
export function statusLine(code, pendingCount) {
  if (!code) return '';
  if (pendingCount > 0) return `${SHORT[code] ?? messageFor(code)}，待同步 ${pendingCount} 条`;
  return messageFor(code);
}
