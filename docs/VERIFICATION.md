# 本輪核對與保留事項（2026-09-11）

使用者原檔含 155 個通路／模型方案、9 個訂閱、22 個活動、18 個模型。原始資料完整保存；164 個方案研究已轉入通用格式，原檔指定的 58 個主榜候選保留。新官方情境替換完全對應的舊列，避免同套餐重複計數。

## 已實際取得及解析

- Z.ai Coding Plan：<https://docs.z.ai/devpack/overview>，Lite 月費、5 小時／週額度與模型扣點係數。
- Z.ai API：<https://docs.z.ai/guides/overview/pricing>，GLM-5.3、Flash、5.2、5.1 的輸入／快取／輸出價。
- OpenCode Go：<https://opencode.ai/docs/go/>，月費與各模型 5 小時／週／月限制。
- Arena WebDev：<https://arena.ai/leaderboard/code/webdev>，保留榜單公布日期與確切版本；先前原檔的 Astra／Fable／Opus 分數與現行抓取有差異，已存新版 benchmark。

本次已有 12 個固定費率情境，並保留使用者的研究換算與多來源訂閱估算。型別、日期、算式與來源解析的自動檢查不等於實際付費跑滿額度。

## 已查到的具體研究差異

1. Devforth <https://devforth.io/agents-for-code/> 頁面仍顯示 2026-09-05 的觀測資料。原檔引用的 Plus $435、Claude Pro $1,217 等聚合值仍可見；它們是來源的觀測等值，非官方固定配額。這些研究是有效比較輸入，不因非官方而移除。
2. Real API Pricing <https://github.com/FeiZhuLulu/real-api-pricing> 說明 Max 15.7B token 永久估算適用於 **2026-09-14 起**。原檔 Max 5×／20× 的多來源估算已引用該項。在目前 09-11 的比較中有未來生效日問題，已於研究 `reviewNotes` 明確記錄。原值與權重保留，調整須由編輯決定，未擅自覆寫。
3. 同一研究的標準 workload 是 97.5% cache read、2.15% fresh input、0.35% output，與固定費率排行的 80/20 情境不同。研究估算保留既有 mix，不能切換快取選項就假造一個新觀測值。
4. 原 HTML 的所有來源並非都已在新一輪重新逐項核對。先前 URL 可達性檢查只代表連線狀態，不代表資料內每個數字正確。原始日期未被本輪匯入時間替換。

## 還需要設定或編輯決定

- AI 搜尋模型、獨立審核模型與金鑰；Artificial Analysis API key。尚未實測付費 AI／AA live call。
- 上述未來生效資料的權重或有效時間調整，及其餘來源的逐項差異審核。
- 部署已依使用者指示暫停，沒有建立新站、推送或操作 Coolify。

## 本機循環實測

2026-09-11 01:27–01:28（台北），執行 run-7ac9a3ab-c2f3-41b9-a9da-cf480664f5d6：81 個來源成功、7 個失敗。6 次為 OpenAI／ChatGPT／R4 的 HTTP 403，另一次 Moonshot 轉址不在核准網域。75 個研究來源產生待核對紀錄（包含沒有可比較原文 hash 的初次基線）；19 個已映射 Arena 模型暫存，109 個未映射名稱保留。原研究值沒有被改動。AI calls=0，未設定 AI 與 AA keys。

## 2026-09-12 多來源詳情與截尾平均

使用者要求將找到的完整資料放入研究詳情，並以「同口徑來源、排除極端值後取平均」作為中心值。`data/catalog.json` 的 Claude／Codex 研究列已保留全部原始樣本；`sourceSamples.weight=0` 表示保留於詳情、但不進中心平均，並在 `reviewNotes` 說明排除原因。研究詳情頁會直接呈現每筆來源連結、日期、月 API 等價值、權重與備註。

- Claude Pro：Devforth、Real API Pricing、Reddit cross-check 平均約 $1,149.71／月，57.49×；個人 dashboard 與最大使用二手整理保留但不納入。
- Claude Max 5×：Devforth 與 139 個 JSONL session 實測平均 $5,756／月，57.56×；Botfarm 下限、重度 JSONL、9/14 才生效的永久條款與二手最大值保留但不提前納入。
- Claude Max 20×：兩個當期帳戶觀測平均 $11,308.855／月，56.54×；高位聚合、明確下限、促銷觀測、未生效條款與二手最大值保留但排除。
- ChatGPT Plus：Devforth、Real API Pricing、ccusage 觀測平均約 $447.45／月，22.37×；$850 個人值與二手最大值保留但不納入。
- ChatGPT Pro 5×：三個可追溯來源平均約 $2,354.89／月，23.55×。
- ChatGPT Pro 20×：以 Devforth、Real API Pricing、Reddit tracker、[Codex issue #43731](https://github.com/openai/codex/issues/43731) 的四個可比樣本做 25% 截尾平均，中心值約 $8,582.24／月，42.91×；[issue #38367](https://github.com/openai/codex/issues/38367) 的約 $800／週異常報告、[CodeSOTA](https://www.codesota.com/guides/token-margins) 與 [Tom's Guide](https://www.tomsguide.com/ai/the-math-doesnt-work-why-your-usd200-ai-subscription-is-secretly-worth-thousands) 的 SemiAnalysis 同源二手最大值保留但不納入。

主要數值來源： [Devforth 觀測額度](https://devforth.io/agents-for-code/)、[Real API Pricing dataset](https://github.com/FeiZhuLulu/real-api-pricing)、[Claude JSONL 實測](https://zenn.dev/tottoko_hamu/articles/2026-05-22-000000?locale=en)、[Botfarm 額度對照](https://botfarm.run/blog/claude-max-true-price/)。這些是 API list-price 等價，不是供應商成本、官方 quota 保證或一般使用者平均。

本次仍未發布 MongoDB stage：本機 MongoDB `127.0.0.1:27017` 目前回傳 `EPERM`，且專案目錄沒有可用 Git 工作樹；本地 catalog 與核驗文件已更新，正式 stage／發布待資料庫恢復後再執行。
