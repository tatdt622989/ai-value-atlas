# 資料模型與查詢

`shared/schema.ts` 的 Zod schema 同時用於匯入、MongoDB 發布與 API。`GET /api/v1/schema` 提供 JSON Schema。資料版本是不可變快照；`pointers.published` 以 compare-and-swap 切換，舊版本保留。

| 集合欄位 | 用途 |
|---|---|
| providers | 官方、轉售、聚合通路；地區與付款條件 |
| models | 模型確切版本、經審查的來源別名 |
| plans | 購買單位、幣別、付款週期、前期支出、費用、期限 |
| rateCards | 各模型輸入／輸出／快取費率，USD 或 credits |
| offers | plan × model × 時段；額度時窗、共享組別與官方基準 |
| research | 原始研究換算與多來源估算，原值、上下界、樣本、權重、信度、hash、原檢查日期 |
| benchmarks | 來源、測試版本、harness、variant、日期、分數、名次 |
| evidence | 來源、日期、摘錄、取得方式與 hash；原文另存 Mongo evidence |
| locks | 人工保護的穩定 ID 路徑、理由、作者與期限 |

`research` 不因來源非官方而退出主榜。保留原檔的 `eligible_main` 決定；已有新版官方 adapter 的完全相同情境由 `replacedByOfferId` 指向新版，原值仍可追溯。164 筆方案研究保存在 canonical catalog，原檔 22 個活動與 18 個模型等完整內容也保存在匯入 archive。未對原檔全部來源完成逐筆新一輪事實核對。

費率情境：預設輸入 80%、輸出 20%，不計快取；快取模式代表輸入的 80% 命中快取。最緊額度時窗決定可用量，週額度按 4 週換算。月費算式含固定費及比例費；年度攤提與一次付款分開。按量支出預設 $20。研究觀測的模型 mix 不套用未知快取拆分；使用一半／四分之一是明示的線性使用情境，不是實測預測。

ResearchValue `originalCheckedAt` 永不被匯入時間刷新；`reviewedAt` 留空表示本專案尚未逐項重做事實複查。`freshness` 沿用原始檢查日期，最多 72 小時複查期。過期查詢排除，歷史資料不刪除。資料有日期衝突時保留原值與 reviewNotes，交給編輯。

API：
- `GET /healthz`：MongoDB 與已發布 snapshot 可用性。
- `GET /api/v1/value`：預設每美元排行；`POST` 同路徑接受 category、utilization、profile、budget、upfrontBudget、providerId、query、minRank、allowAnnual 等偏好。
- `GET /api/v1/catalog?includeExpired=true`：完整 canonical 資料（不含內部鎖定作者、原始全文）。
- `GET /api/v1/benchmarks?category=webdev`、`GET /api/v1/status`、`GET /api/v1/schema`。
- `/api/admin/*` 需 Bearer `ADMIN_TOKEN`（至少 32 字元），提供提案、審核與更新觸發。

回傳包含 calculationVersion、basis、原始研究與 freshness。未來 MCP 可包裝 `rank_values`、`get_plan`、`get_sources`、`get_update_status`，直接呼叫上述 API，避免再寫一套不同的計算。此版尚未部署 MCP server。

若已審核的方案月費改變，衍生倍率以保留的研究 API 等值除以新月費重新換算；原始 ratio、樣本與權重保持不變。來源彈窗同時包含原研究與現行價格依據。
