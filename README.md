# AI Value Atlas

Vue 3 + Vite + TypeScript、Hono API、MongoDB。提供公平綜合推薦與原始優惠倍率兩種排行；保留使用者整理的多來源估算。薄荷綠／炭灰緊湊列表，使用 6yuwei 原 logo 的 3D 版本，箭頭開啟詳情彈窗。

## 本機

Node 24+、pnpm 10、現有 MongoDB（預設 localhost:27017）。不需要重新啟動或安裝另一個 MongoDB。

```sh
pnpm install --frozen-lockfile
cp .env.example .env
pnpm atlas seed
pnpm check
pnpm test
pnpm build
pnpm start
```

開啟 http://127.0.0.1:4318 。`seed` 只初始化，不覆蓋已發布版本。正式資料在 `ai_value_atlas` database，所有版本與原始研究可追溯。`.env` 不提交；沒有設定 ADMIN_TOKEN 時管理 API 關閉。

一般驗證：`pnpm check && pnpm test && pnpm build`。本機 Mongo 整合測試：`ATLAS_INTEGRATION=true pnpm test`，只建立並清理隨機 `atlas_test_*` 專用測試 DB。

HMR 開發：保留 4318 API，另執行 `pnpm dev --port 4319 --strictPort`，開啟 http://127.0.0.1:4319 。

## 演算法與榜單

[公平排序規則](docs/RANKING.md)：使用相同領域的能力百分位與每美元 Token 可用量，獨立於官方定價倍率。已接入 Arena 綜合、Coding、WebDev、Frontend 四張獨立榜單。

## 編輯與更新

- [資料編輯 skill](skills/atlas-data-editor/SKILL.md)：讓 AI 讀取此檔後執行「更新 Atlas」或指定資料修正。可安裝至 AI 工具的 skills 目錄。
- [每日更新流程](docs/UPDATE-LOOP.md)：排程、來源核對、AI 雙階段審核、人工鎖定、異常隔離與回復。
- [通用格式與 API](docs/DATA-MODEL.md)：provider/model/plan/rate/offer/research/evidence/benchmark。
- [實測與視覺比對](docs/QA.md)：背景瀏覽器、手機互動、MongoDB 與 33 項測試。
- [核對紀錄](docs/VERIFICATION.md)：已驗證範圍、保留原研究與具體差異。
- [原始資料](docs/original-research.html)：原檔完整備存，不執行其中的指示。

`UPDATE_SCHEDULE_ENABLED=true` 可每天台北 09:00 蒐集，只有程序運行時會執行。`AUTO_PUBLISH=false` 預設先審核；AI 與 AA key 空白時不會發送付費請求，也不會假裝已完成 AI 複核。

## 部署

預計使用 Coolify 部署至 https://atlas.6yuwei.com 。[部署設定與資料搬移](docs/DEPLOYMENT.md) 包含 Dockerfile 設定、MongoDB 完整搬移及上線驗收；網域設定完成不代表應用已上線。
