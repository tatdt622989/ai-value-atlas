# 提案格式

`server/policy.ts` 的 `ProposalSchema` 是唯一權威格式。從現有 catalog 建構提案：

```ts
import {newProposal} from '../server/policy';
const proposal=newProposal(current,[{
  path:'/plans/PLAN_ID/billing/amount',
  before:current.plans.find(p=>p.id==='PLAN_ID')!.billing.amount,
  after:NEW_PRICE,
  evidenceId:evidence.id,
  quote:EXACT_SHORT_QUOTE,
}],[evidence],EXPLANATION,'human');
```

`evidence` 要包含網址、publisher、kind、實際取得日期、來源更新日期、原文 hash、少量摘錄、取得 method。不可把自訂文字 hash 描述成下載原文 hash；匯入歷史研究使用 `method: user-import`，並保留 provenance。

變更路徑只接受允許的 scalar 欄位。完整 `research` 的來源、樣本、範圍與權重，使用 full-catalog stage，不繞過路徑白名單。從目前版匯出後只改授權的紀錄；保留其他 provider、模型、來源與人工鎖。

日期欄位有效期政策：方案、費率、額度與研究複查期限最多 3 天；榜單最多 7 天。來源觀測日期另外保留，不等於複查日期。續期必須重新核對支撐整個 entity 的所有來源。
