# Coolify 部署

目標網址：https://atlas.6yuwei.com
儲存庫：https://github.com/tatdt622989/ai-value-atlas

## 應用設定

- Build Pack：Dockerfile
- Base Directory：`/`
- Dockerfile：`/Dockerfile`
- Ports Exposes：`4318`
- Domain：`https://atlas.6yuwei.com`
- Healthcheck：HTTP、port `4318`、path `/healthz`
- 容器以非 root 使用者執行，監聽 `0.0.0.0:4318`。

## 執行環境變數

```dotenv
HOST=0.0.0.0
PORT=4318
MONGODB_URI=<Coolify MongoDB 的內網連線字串，含認證>
MONGODB_DB=ai_value_atlas
UPDATE_SCHEDULE_ENABLED=false
AUTO_PUBLISH=false
```

MongoDB 使用持久化儲存，不開放公網連接埠。應用與資料庫需能透過內網互通；容器裡的 `127.0.0.1` 不是獨立 MongoDB 容器。管理功能需要時再設定隨機 `ADMIN_TOKEN`（至少 32 字元）。所有密鑰只填 Coolify 的執行環境變數，不放 Git 或 Docker build arguments。

## 首次資料搬移

目前正式編輯資料在本機 MongoDB；`data/catalog.json` 是較早的初始化資料，不能當作最新發布資料。

1. 在切換前備份來源資料庫與目標資料庫（如果目標已有資料）。
2. 使用 MongoDB Database Tools 的 `mongodump` 備份完整 `ai_value_atlas`，保留 snapshots、pointers、研究來源、審核及更新紀錄。備份只放忽略的 `work/` 或私有備份位置。
3. 在目標空資料庫使用 `mongorestore` 還原；不要對未知的既有資料庫使用 `--drop`。目標若已有資料，先處理版本差異。
4. 啟動應用前核對 `pointers.published` 與對應 snapshot，確認方案、模型、研究筆數和來源一致。
5. 應用啟動只會在未初始化時建立 published pointer，不會取代已還原的發布版本。

只複製 catalog JSON 不會搬移完整歷史，因此完整上線採整庫備份還原。

## 上線驗收

- Coolify 容器建置成功、MongoDB 可連線、healthcheck healthy。
- 正式網址 `/healthz` 回傳 200。
- `/api/v1/catalog` 的版本與搬移來源一致，抽查 R4、Claude、Google AI Pro／Ultra。
- 背景瀏覽器確認排行、搜尋、詳情和來源連結。
- 確認資料庫備份可用後，再決定是否啟用每日更新排程。

參考：https://coolify.io/docs/applications/builds/dockerfile
