# Executor 放哪裡：本機 CLI vs Railway Agent SDK

> 決策日期 **2026-09-16** ｜ 範圍：Layer A（agent-manager）與 Layer B（agent-teammate）之間，
> 「誰真的執行 Claude」這一層的放置與觸發方式。
> 承接 `sandbox-migration-todo.md`（2026-06-10 的 Cloudflare Sandbox 方向，已於 2026-07-04 否決）。

---

## 名詞對照（先看這個，本文通篇在用）

| 簡稱 | 其實是 | 在哪 |
|---|---|---|
| **Layer A** | `agent-manager` —— 控制平面：收 webhook、決定丟哪個 queue、回覆 Slack/Jira | `repos/agent-manager/` |
| **Layer B** | `agent-teammate` —— 實際幹活的：從 queue 拿事做，做完回報 | `repos/agent-teammate/` |
| **Gate** | `pull-ready-gate.sh` —— 一支 shell：先問平台有沒有準備就緒的卡，沒有就結束（0 token），有才叫 `claude -p` | `_utils/scripts/pull-ready-gate.sh` |
| **Path L / Path C** | 本文自訂簡稱。L＝local（本機跑）、C＝cloud（雲端跑）。**不是既有術語** | 見下圖 |

Layer A / Layer B 的命名出處是 `agent-teammate/docs/INITIALIZATION_PLAN.md` 開頭。

### 兩條路（同一件事，不要同時蓋）

```
Path L（本機）： 卡片 → Gate → claude -p → 做完寫回卡片
                 └─ 不需要 Layer A、不需要 queue、不需要 webhook。今天就能跑

Path C（雲端）： 卡片 → 某個入口 → Layer A 決定丟哪個 queue → 容器裡的 Layer B 做 → 回報
                 └─ 三個都要，因為工作要跨機器送到雲端容器
```

所以本文提到「webhook」時，**只與 Path C 有關**；走 Path L 完全不需要。

---

## 0. 結論（TL;DR）

1. **先蓋契約，不先選跑法。** `agent-teammate/packages/core/src/types.ts` 的 `AgentEvent → AgentResult`
   就是那個契約。兩種 runtime 都實作它，「本機還是雲端」退化成部署參數，不是架構決定。
2. **本機 Claude Code CLI 當預設 executor**，但**觸發器從 routine 換成 queue pull**。
   換的理由不是雲端不好，是 routine 綁機器不綁 folder（見 §2）。
3. **Railway 當升級路徑，不是預設。** 只收三類任務：機器關著也得跑、需要爆發平行、
   外部 webhook 有延遲要求。
4. **上雲的前置條件是先給 `works/` 一個家**（見 §5）。沒做完，卡片的 `## 進度記錄`
   會指向已被 `rm -rf` 的容器路徑。
5. **明確否決**：Railway volume 掛 folder、一個 agent 一個 Railway service、把 18 個 agent 各補一支 routine。

---

## 1. 現況盤點（2026-09-16 實測）

| 方案 | 實際狀態 | 證據 |
|---|---|---|
| 本機 CLI + routine 取卡 | ✅ **已在跑**（但只有 1/19 個 agent） | `_docs/routine-registry.md`：`pa-pull-ready` `*/10 * * * *`；19 個 agent 都有 `/pull-ready` skill，只有 `personal-assitant-agent` 掛排程 |
| 本機 queue + 地端 service | ⚠️ **曾經蓋好，2026-07-04 刪除** | `packages/node-agent` 已不存在（`find` 無結果）；README 仍列它＝過時 |
| Railway + Agent SDK | ⏳ Phase 1 ✅，**Phase 2 卡在 secrets** | `agent-teammate/docs/INITIALIZATION_PLAN.md` |

⚠️ agent-manager README 的 Packages 表仍列 `packages/node-agent`，與現況不符，待修。

---

## 2. routine 的致命點：綁機器不綁 folder

原始訴求是「folder 作為可攜帶 agent，到處都可以執行」。folder 確實可攜，
**但觸發器不可攜**。`routine-registry.md` §4 已載明：

- `create_scheduled_task` **沒有 cwd 參數**，綁的是建立當下 session 的 cwd
- **不隨 repo 版控**：實體在 `~/.claude/scheduled-tasks/`，換機器需重建
- **離線補跑**：沒開機時該次不跑，上線後一次補完逾期排程

這與共同規範 #13「不寫 `~/.claude` memory，因為綁機器不綁 agent」是**同一個錯誤，只是換到排程層**。
若把 18 個 agent 各補一支 routine，會得到 18 個換機器就消失、無法 code review、無法版控的隱性設定，
且全部每 10 分鐘同時醒來互撞訂閱 rate limit 與同一台機器的 CPU。

→ **queue pull 天生解掉 concurrency、集中 log、且設定進 git。**

---

## 3. 驗證結果：方案二不必按 token 計價（新事實）

原本假設「Railway = API 計價」。實測否定：

- `claude --version` = `2.1.270`；`claude --help` 有 `setup-token`
  → *"Set up a long-lived authentication token (requires Claude subscription)"*
- Agent SDK `0.3.199` 的 `sdk.mjs`：憑證 env 清單
  `ww = ["ANTHROPIC_API_KEY","ANTHROPIC_AUTH_TOKEN","CLAUDE_CODE_OAUTH_TOKEN", ...]`
  且憑證載入邏輯分支於 `!ANTHROPIC_API_KEY && !CLAUDE_CODE_OAUTH_TOKEN`
  → **SDK 把 `CLAUDE_CODE_OAUTH_TOKEN` 當一等憑證**

**成立的話，方案二的模型費也是訂閱內，成本差距只剩 Railway 基礎設施費。**

仍未驗、上雲前必須回答：

- [ ] token 有效期與輪替怎麼做（長效但會過期；過期時 runner 的行為＝fail 還是靜默卡住？）
- [ ] 訂閱配額是**共用一個池**——雲端 runner 會吃掉本機互動 session 的額度，需不需要分流
- [ ] 放在雲端容器裡無人值守，是否符合訂閱使用條款（**這題不由 agent 判斷，使用者自行確認**）

---

## 4. 成本模型（修正後）

| | 本機 CLI | Railway + OAuth token | Railway + API key |
|---|---|---|---|
| 模型費 | 邊際 ≈ $0 | 邊際 ≈ $0 | Sonnet 約 $0.5–3／任務、Opus 約 $3–15 |
| 10 任務/天 | $0 | $0 | Sonnet 約 $150–900／月 |
| 基礎設施 | $0 | 每 service 約 $5–20／月 ＋ Redis 常駐 | 同左 |
| 閒置 | $0 | **付 24/7**（BullMQ worker 連 Redis，scale-to-zero 不了） | 同左 |
| 真天花板 | 訂閱 rate limit ＋ 機器要開著 | 訂閱 rate limit（與本機共用） | 錢 |

**⚠️ Phase 5「一個 app 一個 Railway service」會把閒置成本乘以 agent 數量**
（9 個 app ＝ 9 個 24/7 常駐 service 在等 queue）。

→ 改成**一個 runner service 消費 N 個 queue，agent 身分由 event payload 決定**，
harness 從 event 或 clone 下來的 repo 讀，不靠部署形態區分。閒置成本 9× → 1×，
新增 agent 也不用開新 service（取代 INITIALIZATION_PLAN Phase 5）。

---

## 5. memory 拆解：已解 80%，缺口只有一個

| 層 | 是什麼 | 現況 | 上雲會不會壞 |
|---|---|---|---|
| harness / skills | `CLAUDE.md`、`.claude/skills/` | 進 git（規範 #13） | 不會。打進 image 或 clone |
| **任務狀態** | 卡片 `狀態:` ＋ `## 進度記錄` | **已在 D1，改的當下就是線上**（#12） | **不會。executor 天生無狀態** |
| session 續作 | 開新 session → 撈 `running/` → 照卡片接續（#10） | 已廢除 STATUS.md、不靠 `--resume` | 不會。早就設計成可重啟 |
| **工作區產物** | `{agent}/works/{卡號}/` | **只在本機檔案系統** | **會壞。ephemeral 目錄 `rm -rf` 就沒了** |
| 知識沉澱 | `_raws/` → `_knowledgebase/` | 本機 collector/processor 23:00 | 會壞。要本機檔案＋git＋本機 MCP，**本來就該留本機** |

規範 #10 / #12 已經把 executor 無狀態化了——卡片是唯一權威、狀態即時寫線上、
中斷就開新 session 讀卡片接續。這正是雲端無人值守需要的性質。

**唯一缺口 = `works/`。** 規範 #10 要求診斷過程寫 `{agent}/works/{卡號}/`，卡片會指向該路徑；
在 Railway 跑完 `cleanup()` 之後那是死連結。
→ 上雲前：任務結束把 `works/{卡號}/` commit 到專用 repo（或丟 R2），**卡片記 URL 不記本機路徑**。

---

## 6. 派工判準

沿用 `routine-registry.md` §2 的判準並擴充：

| 任務性質 | 去哪跑 |
|---|---|
| 需要本機檔案 / 本機 git clone / 本機 MCP | **本機**（`_raws/`、`_knowledgebase/`、collector、processor） |
| 機器關著也得跑 | Railway |
| 需要爆發平行（一次多張卡） | Railway |
| 外部 webhook 有延遲要求 | Railway |
| 兩者都不需要、只是條件判斷 ＋ 改狀態 ＋ 推 Slack | Workers Cron（如事故 probes） |
| 其他 | **本機**（預設） |

---

## 7. 待辦（有序）

1. [ ] 驗 §3 三個未答問題（決定成本模型，半小時）
2. [ ] 給 `works/` 一個家（**方案二的前置條件**，見 §5）
3. [ ] 寫本機 runner：long-poll Layer A → `claude -p --output-format stream-json` spawn 在正確 cwd
       → 串 log 回報 → 寫卡片。**不重建整個 node-agent**（process registry / UI / SSE 是它被刪的原因），
       只要 pull-spawn-report loop，邏輯照抄 `/pull-ready` skill，改由 queue 推而不是 cron 拉
4. [ ] 補 runtime parity：`agent-teammate/packages/core/src/runner.ts` 的 `allowedTools` 只有
       `Bash/Read/Edit/Write/Glob/Grep`，**缺 `WebFetch`/`WebSearch`/`Task`**。
       同一張卡在兩種 runtime 會得到不同品質產出 → 「同一契約」不成立。
       要嘛補齊，要嘛寫進契約說明雲端能力較窄、哪類卡不派給它
5. [ ] 加預算閘：`runner.ts` 已收 `usage.totalCostUsd` → 加單任務上限 ＋ 日累計上限，
       超過 fail 並 `wb block --kind decision`。
       **無人值守 ＋ `bypassPermissions` ＋ 無成本上限 ＝ 唯一會半夜後悔的組合**
6. [ ] 修 agent-manager README 的 `packages/node-agent`（已不存在）
7. [ ] 改 INITIALIZATION_PLAN Phase 5 為「單 runner service 消費多 queue」（見 §4）

---

## 8. 明確否決（別再繞回來）

| 否決項 | 理由 |
|---|---|
| ~~**Railway volume 掛 folder**~~ **⚠️ 2026-09-17 修正，見 §11.1** | 原否決理由（雪花、單 region、綁單一 service）**只適用於把 volume 當資料唯一本體**。volume 當「開工時 git pull 的快取」是可行且簡單的，在一 agent 一 service 的拓樸下綁單一 service 也不是問題 |
| ~~**一個 agent 一個 Railway service**~~ **⚠️ 2026-09-17 修正，見 §11.2** | agent ↔ queue 在 schema 裡本來就是 1:1（`schema.ts:40`），一 agent 一 service ＋ 換 env 是**設計本意**，不是 workaround。它用閒置成本換簡單，並免費解掉 per-agent secrets |
| **18 個 agent 各補一支 routine** | 綁機器、不版控、同時醒來互撞 rate limit，見 §2 |
| **Cloudflare Sandbox** | 2026-07-04 已否決，見 `sandbox-migration-todo.md` |

---

## 9. 2026-09-16 補充：實測後的三項修正

### 9.1 routine 不該用來輪詢「有沒有工作」

**原始判斷錯誤**：§0 建議「本機 CLI 當預設，觸發器從 routine 換成 queue pull」，
但沒算空轉成本。使用者先前把 `pa-pull-ready` 關掉的理由正是這個，而且是對的。

每次排程觸發都是**開一個全新 Claude session**（system prompt ＋ tool 定義 ＋ 根
`CLAUDE.md` ＋ agent `CLAUDE.md` ＋ 排程 SKILL ＋ `pull-ready` SKILL），還沒碰到
`wb` 就先燒掉兩三萬 token。`*/30` ＝ 一天 48 次 ≈ **每天 100～170 萬 token 純空轉**。

**真正的問題**：「有沒有工作」這個判斷被放在 Claude 裡面。那只是一個 HTTP 請求。

**解法**：閘門移到 Claude 外面。`_utils/scripts/pull-ready-gate.sh`（＋
`_utils/templates/pull-ready-gate.plist.template`）：shell 先問平台，0 張就靜默
`exit 0`（成本＝一次 HTTPS 請求、**0 token**），有卡才 `exec claude -p "/pull-ready"`。

附帶解掉 §2 記的兩個 routine 問題：script 與 plist **可進 git**（可版控、可 review），
cwd 明寫在 script 裡而不是隱性綁在建立當下的 session。且內建互斥鎖——dev 類任務
動輒 20–40 分鐘，沒有鎖會疊出多個 claude process 搶同一個 repo 的 worktree。

> ⚠️ 測試一律加 `--dry-run`。不加會真的認領卡片（改狀態、建 `works/` 資料夾），
> 那是真實副作用不是演練。

**這也意味著 §0.2「換成 queue pull」對這個用途是過度設計**——
「卡片拉到準備就緒 → agent 自動執行」不需要 queue、不需要 Railway，
`/pull-ready` skill（19 個 agent 都已安裝、slug 皆正確）＋ 一個 shell 閘門就夠了。

### 9.2 agent 可攜性要分兩類，不是一個問題

「把 agent 資料夾丟進容器就變成新 agent」對**一次性任務型** agent 成立，
對**對話型** agent 不成立。

sales-agent 是對話型：「未提及組織時追問業務，**等待回覆後繼續**」「缺欄位時追問，
**等待補充**」「多候選時請業務選擇，**等待選擇**」「同一 thread 共享對話歷史」。
而 `runner.ts` 是一次性：`query()` → 解析 → `cleanup()` → 結束。
INITIALIZATION_PLAN 自己寫了「非 MCP-as-channel（不需常駐 session）」。

一次性 runner 輸出「❓ 請提供價格」然後退出 ＝ session 丟掉。業務在 thread 回覆
→ Layer A 送一個新 event → 沒有記憶的新容器 → 又從頭問組織。

**缺的機制**：`repos/agent-sdk-demo/README.md` 已記錄——「把 `result` 帶回來的
`sessionId` 在下一輪傳成 `resume`，SDK 自己接續」。需要 Layer A 存
`slack_thread_ts → sessionId`、`runner.ts` 支援 `resume`（目前沒有），
且 `cleanup()` 不能連 session 狀態一起刪。

**派工判準補充**：對話型 agent 在 session 續接做好之前，不要派到 Layer B。

### 9.3 固定 image ＋ agent 當資料（取代 Phase 5）

| | 一 agent 一 image（Phase 5） | 固定 image ＋ agent 當資料 |
|---|---|---|
| 新增 agent | 新 Dockerfile ＋ 新 service ＋ 新部署 | commit 一個資料夾，不用部署 |
| image 數 | N | 1 |
| 閒置成本 | × N 個常駐 service | × 1 |
| 改 core | N 個 service 全部重建 | 一次 |

**機制必須是開工時 clone，不是掛載 volume**（§8 已否決 volume 的理由全部適用）。
clone 讓資料夾保持為那個可攜單位，image 保持無狀態。

現有程式碼離這個只差一步：`runner.ts` 的 `harness` 已是參數、`prepareWorkspace`
已有白名單 clone。**2026-09-16 已完成前半**：agent-teammate `fix/agent-skills-not-loaded`
新增 `projectAgentSkills()`，把 `apps/{name}/.claude/skills/` 投影進 cwd，
並在 `runner.ts` 明寫 `skills:"all"`。

> 順帶修掉一個一直在線的 bug：那些 skill 目錄**從來沒有被載入過**——
> `settingSources:["project"]` 只看 cwd（clone 下來的 repo 或空目錄），不看 app 目錄。
> sales-agent 的 5 個業務技能、b2b-crm 的 6 個技能全部失效，
> 而 harness 卻寫著「必須呼叫 /xxx 技能，不得自行發明操作流程」。

### 9.4 另一個跨 repo 對讀撈到的洞

`agent-sdk-demo/README.md`：「`settingSources: []` 擋不掉 MCP 連接器……要隔乾淨
得再加 `strictMcpConfig: true`」。**`runner.ts` 用 `settingSources:["project"]`
且沒設 `strictMcpConfig`**——在容器裡沒事，但誰在本機跑 Layer B runner，
本機 Claude Code 連過的 Gmail / Notion / Jira MCP 會整包掛進去。未修。

---

## 10. Routine 數量、headless 的互動限制、固定 image 的缺口

### 10.1 routine 數 ＝ 執行者數，不是節點數

**問題**：8 個 workflow × 4 節點 ＝ 32 節點，其中 10 個由同一個 agent 負責
→ 直覺上要開 10 支 routine，無法管理。

**錯在把 routine 當成 workflow 的一個步驟。** 它只是「叫某個執行者起床」的鬧鐘。
**節點身分屬於工作項目（卡片），不屬於鬧鐘。** 所以那 10 個節點共用
**1 個 gate**——gate 問「我有沒有準備就緒的卡」，卡片自己說它是哪個節點。
`pull-ready-gate.sh` 已經是 agent-scoped，不需要改。

**真正缺的是「推進圖」的那個東西**（目前那個角色是人工把卡片拉到準備就緒）：

| 放哪 | 做法 | 評價 |
|---|---|---|
| **cloud-workbench（D1 ＋ Workers Cron）** | workflow 圖存 D1；某卡結案 → 建立／放行下一節點的卡 | **推薦**。合 `routine-registry.md` §2 判準：「不需要 agent 思考、不需要本機檔案 → 可上 Workers Cron」。推進圖是純狀態轉換 |
| Layer A（agent-manager） | 已有 Broker → Routing Rule → Queue；節點完成 → event → 下一個 queue | 需要 webhook 驅動入口時才值得 |
| 卡片帶 `next` 欄位 | 最便宜、零新基建 | 圖散在 32 張卡裡，看不到 workflow 全貌 |

採 D1 後的數量：**N 個 gate（N ＝ 真的會執行工作的 agent 數）＋ 1 支 Workers Cron**。
新增第 9 個 workflow ＝ insert 幾筆 rows，不是新建 routine。32 → 4。

### 10.2 `claude -p` 不能對話，但 session 沒丟掉

`-p, --print` ＝ "Print response and exit"，無互動。三個細節：

1. **session 可以接回去**：`--output-format json` 回傳 `session_id`，
   事後 `claude --resume <session-id>` 就是一個正常互動 session。
   所以是「先自動跑完，要討論再接回去」，不是「只能看結果」。
2. **必須明寫 `--permission-mode`**：headless 下任何會彈權限詢問的動作
   ＝沒人能回答＝直接被拒，任務死在那裡。已修進 `pull-ready-gate.sh`
   （預設 `bypassPermissions`，`GATE_PERMISSION_MODE` 可覆寫）。
   關鍵：**PreToolUse guard hook 不受 permission mode 影響**，
   `guard-task-card` / `guard-secret-pattern` / branch guard 全都還在攔，
   所以這不是把防護拆掉。
3. **「需要人」要變成卡片的一級狀態，不要變成互動 prompt**：
   `wb block <id> decision|permission|external|physical "在等什麼"` → 線上「待裁決」撈出來。
   這比互動詢問**更適合**無人值守——凌晨三點的一個 prompt 會卡住整條隊列，
   一張 blocked 卡不會。

### 10.3 「固定 image ＋ agent 當資料」的缺口清單

已完成：skills 投影（§9.3）＋ `harness` 早就是參數。剩下：

| # | 缺什麼 | 現況（有據） | 為什麼卡 |
|---|---|---|---|
| 1 | agent 身分從 event 來 | `config.ts`：`agentId: process.env.AGENT_ID ?? "agent-teammate"`，部署層固定，heartbeat 用它 | 一個 process 服務多個 agent，身分必須 per-task |
| 2 | 一個 service 消費多 queue | `env.queueName` 單一必填，`startConsumer` 綁一條 | 不改就還是一 agent 一 service，閒置成本 ×N |
| 3 | agent 資料夾開工時取得 | `index.ts` 於 boot `readFileSync(appRoot/CLAUDE.md)` ＋ `allow-repos.json`，打進 image | 要變成「資料」就不能在 build 時固化 |
| 4 | allow-repos 的信任邊界 | 從 image 內檔案讀（＝可信） | 改 clone 後白名單必須來自可信的 agent 資料夾 git ref，**不能由 event 指定**，否則安全邊界被呼叫方控制 |
| 5 | per-agent secrets | Railway env 注入，一 service 一組 | sales-agent 要 `PRODUCT_API_KEY_*`、dev agent 要 git token；一個 image 服務 N 個 agent 時要依 agentId 解析 |
| 6 | 固定 image ＝ 固定工具鏈 | `node:22-slim` ＋ git | agent 若需要 bun（sales-agent 的 `.mcp.json` 就指向 bun）、Go、Python，image 得是所有需求的聯集。**這是本方案的真實代價，要先盤點** |
| 7 | `.mcp.json` 可攜 | sales-agent 寫死 `/Users/wangxunyang/.bun/bin/bun` ＋ 絕對路徑 | 容器裡必壞。要嘛 channel 上移 Layer A（已是方向），要嘛 adapter 一起容器化 |
| 8 | 對話型 sessionId resume | 無 | §9.2 |

**1 + 2 + 3 是核心三件**，都在 `packages/core`、互相依賴，做完方案就成立。
4 是安全前提不能跳；5、6 是營運前提；7、8 看 agent 類型。
最小可行順序：**1+2+3 → 4 → 5**，6 先盤點（列出每個 agent 真正需要的工具鏈，看聯集有多醜）。

> 順帶：`config.ts` 的 `model` 預設是 `claude-opus-4-8`。現行最新是 Opus 5 / Sonnet 5——
> 若哪天真走 API 計價，節點型例行工作換 Sonnet 5 是成本差最大的單一變數。

---

## 11. 2026-09-17 修正：推翻 §8 的兩條否決

### 11.1 Railway volume 不該被全盤否決

§8 原本把「volume 掛 folder」列為明確否決。**那個理由只適用於把 volume 當成資料的唯一本體。**

真正的判準是一個問題：**誰去更新 volume 裡的內容？**

| 誰更新 | 結果 |
|---|---|
| 人工編輯 / scp 進去 | 🔴 那份跟 git 分岔，過幾個月沒人知道哪個對。**這才是原本要否決的東西** |
| 開機／開工時 `git pull` | ✅ volume 只是**快取**（省 clone 時間），資料本體仍是 git。可行且簡單 |

而且在「一 agent 一 service」的拓樸下，Railway volume 綁單一 service 的限制剛好不成問題——
一個 service 配一個 volume，一對一。

**修正後的立場**：volume ＋ 開工時 pull ＝ §10.3 #3 的可行解法之一，與 ephemeral clone 並列。
被否決的只有「volume 是唯一本體、靠手動維護」這種用法。

### 11.2 「一 agent 一 service ＋ 換 env」是設計本意

§4 曾以閒置成本為由把它列為要改掉的東西。但：

- `agent-manager/apps/api/src/db/schema.ts:40` —— `queueId ... // 1:1, nullable until assigned`
- `agent-teammate/packages/core/src/types.ts` 的 `AgentEventSchema` **沒有 agentId 欄位**

也就是 **agent 身分本來就等於 queue**。固定 image ＋ 換 env ＋ 一個 service 消費一條 queue
是照著設計走，不是繞路。它以閒置成本換取簡單，而且**免費解掉 §10.3 #5**（Railway env
天生 per-service，不用做 agentId → secret 的解析）。

**連帶降級**：§10.3 的 #1（agentId 從 event 來）與 #2（多 queue）**不是「agent 當資料」的前提**，
只有在「想省閒置成本、讓一個 process 服務多個 agent」時才需要。

**修正後的缺口清單**（取代 §10.3 的優先序）：

| # | 項目 | 在一 agent 一 service 拓樸下 |
|---|---|---|
| 3 | agent 資料夾開工時取得 | 🔴 **唯一非做不可的**——否則改 harness 要 rebuild + redeploy，正好是「agent 當資料」的反面。解法二選一：ephemeral clone，或 volume ＋ pull（§11.1） |
| 4 | allow-repos 信任邊界 | #3 的附帶，不能跳 |
| 6 | 固定 image ＝ 固定工具鏈 | 先盤點各 agent 真正需要的工具鏈聯集 |
| 7 / 8 | `.mcp.json` 可攜 / 對話型 resume | 依 agent 類型 |
| ~~1~~ ~~2~~ ~~5~~ | agentId in event / 多 queue / per-agent secrets | **不需要**（見上） |

### 11.3 session id 的歸屬

- **卡片型工作**：一張卡 ＝ 一次 session，所以卡片是正確位置。
  不用改 schema——`wb note` 是 append-only 的進度記錄，記一行
  `session: $CLAUDE_CODE_SESSION_ID` 即可（同張卡跑幾次就幾筆）。
  **已實作**於 `_utils/skill-store/shared/pull-ready/SKILL.md` §4（認領後立刻記，
  因為跑到一半掛掉的 session 才最需要接回去看）。
- **對話型（Slack thread）**：沒有卡，所以是 `thread_id → session_id` 的對照表，放 Layer A。
- `CLAUDE_CODE_SESSION_ID` 是 Claude Code 注入的環境變數，實測值等於
  `~/.claude/projects/<cwd-slug>/<session-id>.jsonl` 的檔名，即 `claude --resume` 吃的 id。

**把 transcript 搬進 agent folder 的想法：先不要。** 兩個坑——
`CLAUDE_CONFIG_DIR` 雖然能換掉 `~/.claude`，但 SDK 程式碼顯示**一旦設了它就不再回頭讀
原本登入的憑證**（認證得改走環境變數）；而且 transcript 只增不減，保留期得自己管。
收益（換機器能接回去）不見得抵得過這兩件事。要搬之前先解決保留期。
