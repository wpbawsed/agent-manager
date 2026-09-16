# Executor 放哪裡：本機 CLI vs Railway Agent SDK

> 決策日期 **2026-09-16** ｜ 範圍：Layer A（agent-manager）與 Layer B（agent-teammate）之間，
> 「誰真的執行 Claude」這一層的放置與觸發方式。
> 承接 `sandbox-migration-todo.md`（2026-06-10 的 Cloudflare Sandbox 方向，已於 2026-07-04 否決）。

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
| **Railway volume 掛 folder** | 單 region、綁單一 service、不能多 replica 共用、無備份故事，且會慢慢跟 git 長歪成雪花。**可攜性來自 git，不來自 volume。** 現行 `workspace.ts`（allow-repos 白名單 → `git clone --depth 1` → 做完 `rm -rf`）是對的，維持 |
| **一個 agent 一個 Railway service** | 閒置成本乘以 agent 數量，見 §4 |
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
