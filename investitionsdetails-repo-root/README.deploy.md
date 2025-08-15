# 投资详情 – 静态性能概览（中文）

此包是为部署在 **massmutualventures.de/investitionsdetails** 而构建的。  
它完全自适应（桌面端 & 移动端）、已进行德语本地化，并且可在无服务器/数据库环境下运行。

## 结构
- `investitionsdetails/` – 前端（仅静态文件）
  - `index.html`
  - `assets/styles.css`
  - `assets/app.js`
  - `data/recommendations.json` – 数据源（由 Actions 填充）
- `.github/ISSUE_TEMPLATE/` + `backend/handle-issue.mjs` – 管理工作流（Issues → JSON）
- 工作流：`.github/workflows.yml`

## 部署（GitHub Pages + 自定义域名）
1. 复制 **文件夹 `investitionsdetails/`** 到你现有的仓库根目录（该仓库已绑定域名 `massmutualventures.de`）。
2. 复制 **`.github/ISSUE_TEMPLATE/`、`backend/handle-issue.mjs`、`.github/workflows.yml`** 到仓库根目录（如果已存在，请合理合并）。
3. 确保 GitHub Pages 已为该仓库启用，并且自定义域名已指向 `massmutualventures.de`。
4. 之后，客户页面可通过 **https://massmutualventures.de/investitionsdetails/** 访问。
5. 管理端：在 **Issues** 中使用模板 “新增推荐 / 编辑推荐 / 导入（JSON）”，工作流会将数据写入 `investitionsdetails/data/recommendations.json`。

## 股价
- 数据来源：Yahoo / Stooq。如果两者均失败，则显示 `0`（避免价格混乱）。
- 当无实时股价可用时，盈亏百分比（P/L %）显示 “—” 而不是 -100%。

## 移动端
- 卡片式布局，分区清晰，点击区域大，标签为德语。
- 桌面端使用带固定表头的表格；移动端无表头（卡片式显示）。
