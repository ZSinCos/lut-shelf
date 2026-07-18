# LUT 书架

一个基于 Electron 的 LUT（3D Lookup Table）预览和管理工具。

## 功能

- **文件夹树导航** — 浏览 LUT 目录结构
- **书架网格** — 缩略图懒加载、分页/无限滚动
- **LUT 信息管理** — 笔记、作者、风格标签
- **实时预览** — 上传参考图（支持 RAW），强度调节，对比模式
- **收藏系统** — 收藏喜爱的 LUT
- **标签系统** — 自定义标签分类管理
- **搜索** — 全字段模糊搜索
- **导出** — 将套用 LUT 后的图片导出为 PNG/JPG
- **缩放/平移** — 预览视图支持滚轮缩放和拖拽平移
- **深色/浅色主题**

## 使用

```bash
npm install
npm start
```

## 构建

```bash
npm run build
```

生成的便携版 exe 在 `dist/` 目录下。

## 技术栈

- Electron 28
- better-sqlite3
- 原生 Canvas 2D 渲染
- IntersectionObserver 懒加载
