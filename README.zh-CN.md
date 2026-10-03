# lr-remote-cull

[English](README.md) | 简体中文

在 iPhone 或 iPad 上给电脑里 Lightroom Classic 的照片打旗标、星级和色标。所有写入都由 Lightroom 通过官方 SDK 完成，本工具从不直接打开 catalog 文件；手机上的每次标记在 Lightroom 里都是一条可以 `编辑 > 还原` 的记录。

## 组成

- `plugin/lr-remote-cull.lrplugin`：Lightroom 插件，长轮询本机伴随服务并执行指令
- `server/`：电脑上运行的伴随服务（Node.js 24），只监听 `127.0.0.1`
- `web/`：手机和平板上打开的网页
- `spike/`：开发期的预览性能实验，结论见 `docs/spike-results.md`

## 一次性安装

1. `npm install`
2. Lightroom Classic：`文件 > 增效工具管理器 > 添加`，选择 `plugin/lr-remote-cull.lrplugin`
3. Tailscale：电脑、iPhone、iPad 登录同一账号；在管理后台 `https://login.tailscale.com/admin/dns` 启用 MagicDNS 和 HTTPS Certificates
4. `tailscale serve --bg 47800`（只把网页端口暴露给自己的 tailnet，重启后保留）

## 日常使用

1. 打开 Lightroom Classic
2. `npm start`，终端会打印 tailnet 地址和二维码
3. 用 iPhone 或 iPad 扫码（设备上 Tailscale 需开启）。建议在 Safari 里"添加到主屏幕"，这样可以全屏使用

在家和外出用的是同一个地址；在家时 Tailscale 会自动走局域网直连。

## 操作

- 左右滑动，或点照片左右两侧切换
- 上滑留用，下滑弃用。手势不会取消已有旗标：对已有同样旗标的照片重复手势，只会跳到下一张
- 点照片中间隐藏或显示标记药丸和文件名标签
- 留用、弃用会自动跳到下一张；星级和色标不跳
- 再点一次已激活的旗标、星级、色标即取消
- 过滤开关同时显示"未标记"和"全部"及数量；切换时若当前照片仍在新列表中，会停留在这张
- 标记会自动从 Lightroom 刷新，在另一台设备上的改动或在 Lightroom 里的撤销几秒内就会显示
- 横屏时操作移到右侧细栏：留用在星级上方，弃用在色标上方
- 首页的搜索框输入即过滤文件夹和收藏夹；文件夹可按名称或导入顺序排序，照片可选拍摄时间或文件名顺序。有子项的行可以展开和折叠

删除照片不在本工具范围内：在手机上打"弃用"，回到电脑后用 Lightroom 的 `照片 > 删除排除的照片`。

## 排查

- 网页顶部提示"Lightroom 未运行"：确认 Lightroom 已打开且插件状态为"已安装并正在运行"。仍不行时，点 `图库 > 增效工具额外信息 > Remote Cull: start bridge` 手动重启插件的连接
- 插件日志：`%TEMP%\lr-remote-cull-plugin.log`，记录启动、退出和出错的命令
- 电脑本机访问 `https://<机器名>.ts.net` 可能超时，这是 Windows 没有使用 MagicDNS 解析，不影响手机和平板
- 在 Safari 里从屏幕左边缘右滑是浏览器的"后退"手势，会离开页面。从主屏幕图标打开可以避免

## 开发

- `npm test`
- 设计文档：`docs/superpowers/specs/`
- 实施计划：`docs/superpowers/plans/`
- 分支：`main` 稳定，`dev` 集成，功能在 `feat/*`，修复在 `fix/*`

## 已知限制

- 打开文件夹或收藏夹期间，标记自动从 Lightroom 刷新（每 5 秒，很大的文件夹会更久）；新增或移除的照片需要返回再进入才会显示
- 预览图缓存在 `.cache/previews/`，照片在 Lightroom 里重新调色后不会自动刷新，删除该目录即可
- "Lightroom 正忙"的回滚提示只有自动化测试覆盖：实测中首选项、导出等对话框都不会阻止写入，无法人工复现
- 只识别 Lightroom 默认的五种色标；使用自定义色标集打的标签会显示为未标记，点按色块会替换掉原标签
- 需要在线使用；离线缓存在后续版本中加入

## 许可

MIT
