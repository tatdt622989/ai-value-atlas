# 每日更新循環

程序開啟 `UPDATE_SCHEDULE_ENABLED=true` 時，每天 `UPDATE_HOUR_UTC` 執行一次（預設 UTC 01:00，即台北 09:00）。啟動晚於當日時間會補跑；當天時段之後已有完成／部分完成的手動更新便不重複抓取；MongoDB lease 及當日 trigger 防止同時多副本重跑。服務停止時不會執行，需運行中的服務才能提供每日更新。

1. 以核准網域清單取得官方與原研究來源，最多並行 3 個，timeout、redirect、回應大小有上限。原文、hash、日期寫入 evidence。
2. 將研究來源與原紀錄比對，建立 source_reviews；來源變動只形成待核對差異，不自行刪除研究估算。
3. Arena adapter 分別抓取 Agent Overall、Agent Code、WebDev Overall、WebDev Frontend，核對頁面分類、精確模型名稱、日期、名次區間、完整榜單規模與測試版本。每個來源獨立失敗，不把 Overall 轉址結果改名為 Frontend。只收錄每張榜單前 20 名；20 名以外不進 catalog。AA 透過 free Data API 分頁，同樣只取各指數前 20；任何一頁失敗即不發布該輪 AA 資料。未知模型保留 discoveries，不能靠模糊別名猜測。
4. Z.ai／OpenCode 費率與額度需三個來源全成功且格式符合。只有最新發布版本的完整來源 bytes 全相同且 `AUTO_PUBLISH=true` 時可續期。文字、價格、配額或規則變動一律暫存，等待編輯核對。
5. 已設定 AI 時，Responses API 搜尋最新官方資料並輸出嚴格 schema，另一次呼叫獨立審核。新來源先進 discoveries；沒有保存的原始證據不得發布。價格／條款／估算結論改動要求編輯決定。
6. 通過政策才切換 snapshot。並行修改造成版本衝突時停止；人工鎖定不覆蓋。查詢時再次檢查期限，所以排程失敗不會自動延長舊資料壽命。

目前本機已配置 MongoDB；AI、AA key 尚未提供，因此不能聲稱完整 AI 搜尋與獨立審核已實測。可直接讓 AI 使用 `skills/atlas-data-editor/SKILL.md` 搜尋、核對、建立及發布授權的修改。`pnpm atlas update` 亦可手動執行 collector。

`AUTO_PUBLISH=false` 預設只暫存，適合先人工穩定來源格式。開啟後只有非異常的已映射榜單及完全未變的固定費率來源可自動發布；研究權重、來源選擇、重大變更仍交給編輯。

執行紀錄在 runs；待審提案在 proposals／staged_catalogs；來源差異在 source_reviews；新模型與新來源在 discoveries；原始匯入在 legacy_records。沒有 API key 不會誤寫為「AI 已審核」。排程每日一次包含失敗紀錄；失敗後可以手動重試，避免同一天無限付費重跑。
