# 系統整合設計：介接層 ／ 工作流層 ／ Agent 層

> 決策日期 **2026-10-29**。範圍：agent-manager、agent-broker、template-claude-agent、agent-teammate 四個 repo 的整併。
> 本文的每個決定都經過逐題確認（Q1–Q20），編號附在各節，方便回頭對照。
> 取代或修正的舊決策列在 §9。

---

## 0. 結論

1. **agent-manager 是主體**，同時是介接層與工作流層。agent-broker 的 `core` 併進來，`sdk` 刪掉，`sandbox-worker` 移除。
2. **工作流照 LangGraph 的模型設計**：Workflow 是一張圖，節點是 agent，邊依結果分支，每次執行的狀態一步一個 checkpoint 存在 PG，可以中斷等人。推進圖的是 agent-manager，**agent 不知道自己在工作流裡**。不引入 LangGraph 套件。
3. **template-claude-agent 變成共用的殼**（base image）。每個 agent 是一個只放腦袋的 repo，容器開工前 `git pull`，所以 push 到腦袋 repo 就等於更新 agent。
4. **agent-teammate 凍結**。試點只搬 personal-developer，其餘 8 個 app 之後一個一個搬。
5. **部署**：同一個 image，本機 docker compose 先跑通，Railway 之後只換 env 和 volume。

---

## 1. 名詞（Q1）

| 名詞 | 是什麼 | 在哪 |
|---|---|---|
| **殼** | template-claude-agent 的 image：runtime（`src/`）、依賴、`claude` 執行檔、護欄、網頁 UI | image 內的 `/app`、`/etc/claude-code` |
| **腦袋** | 決定「這是哪個 agent」的檔案：`CLAUDE.md`、`GOALS.md`、`CONTEXT.md`、`package.json`、`.claude/`、`bin/` | 每個 agent 一個 repo，進容器後在 `/agent` |
| **workspace** | 執行狀態：clone 下來的工作 repo、`works/`、`.state/`（Session 紀錄、核准、對話串對照表） | 每個 agent 一個 volume，掛在 `/agent/workspace` |
| **Workflow** | 一張由 agent 組成的圖（對應 LangGraph 的 `StateGraph`） | agent-manager PG |
| **Run** | 一次 Workflow 執行，帶著自己的 state（對應 LangGraph 的 thread） | agent-manager PG |
| **Step** | Run 裡走過的一個節點，也是一個 checkpoint | agent-manager PG |

「置換腦袋就是新 agent」：同一個殼，換一個腦袋 repo、換一組 env、換一個 workspace volume。

---

## 2. 四層架構

```
外部平台（Slack / Jira / GitHub / LINE / Notion / Railway）
   │ webhook                                     ▲ 回覆（reply policy）
   ▼                                             │
┌─ 介接層：agent-manager api ──────────────────────────────────────┐
│ Broker → normalizers → AgentEvent         packages/broker-core   │
│                     │                     (dispatchReply 等)     │
│              Routing Rule                                         │
│          ┌──────────┴───────────┐                                 │
│      目標＝queue           目標＝Workflow                          │
└──────────│──────────────────────│──────────────────────────────────┘
           │            ┌─ 工作流層：Workflow 引擎（agent-manager）─┐
           │            │ Run / Step / state / 條件邊 / 中斷 / 重試 │
           │            └──────────│────────────────▲─────────────┘
           ▼                       ▼ 下一步的 job    │ PATCH /internal/events
        BullMQ queue（一個 agent 一條，1:1）         │
           │                                         │
┌─ Agent 層：殼（template-claude-agent image）＋ 腦袋 repo ─────────┐
│ consumer → 開工前 git pull 腦袋 → runOnce() → 回報結果/heartbeat │
│ 網頁 UI：Session、待核准、我的工作、指標                          │
└──────────────────────────────────────────────────────────────────┘
```

---

## 3. 介接層

### 3.1 agent-broker 併進 agent-manager（Q3、Q6）

| 來源 | 去向 |
|---|---|
| `agent-broker/packages/core`（`reply.js`、`schema.js`、Notion helpers） | **`agent-manager/packages/broker-core`**，pnpm workspace 套件；`apps/api` 的依賴從 `@wpbawsed/agent-broker-core@^0.1.1` 改成 `workspace:*` |
| `apps/api/src/types/agent-broker-core.d.ts` | 搬家時順便把 broker-core 改成 TypeScript 或補 `.d.ts`，這個 ambient 宣告就可以刪掉 |
| `agent-broker/packages/sdk`（BullMQConsumer、cf-consumer、health） | **刪除**。目前沒有人用，template 自己的 `consumer.ts` 直接用 bullmq，而且刻意不用 schema 驗整包（teammate 就是被 zod 刪掉 `brokerId` 才出事） |
| `agent-broker/examples/devops-agent` | 刪除 |
| npm 套件 `@wpbawsed/agent-broker-core` | 不再發佈 |
| GitHub repo `agent-broker` | README 加「已併入 agent-manager」；**archive 由使用者自己操作** |

以後真的出現「不是 template 的第三方 agent」，再從 template 的 `consumer.ts` 抽一份出來，不從舊 sdk 復活。

事件格式的唯一定義是 `apps/api/src/normalizers/types.ts` 的 `AgentEvent`。

### 3.2 移除 sandbox-worker

Cloudflare Sandbox 方向在 2026-07-04 已經否決（`sandbox-migration-todo.md`），留著的程式碼只會誤導。要動的地方：

| 位置 | 動作 |
|---|---|
| `apps/sandbox-worker/` | 刪除 |
| 根 `package.json` 的 `deploy:sandbox` | 刪除 |
| `docker-compose.yml` 的 `SANDBOX_WORKER_URL`、`SANDBOX_INTERNAL_TOKEN` | 刪除 |
| `apps/api/src/routes/agents.ts`、`agent-push.ts`、`services/agents.ts`、`services/agent-template.ts` | 拿掉 sandbox 分支；`type=cloud` 不再代表「manager 幫你部署到 Sandbox」，改成單純標示「這個 agent 跑在雲端」 |
| `apps/api/src/db/schema.ts` 的 `agents.runtimeCmd` 與 `type=cloud` 註解 | `runtimeCmd` 只有 Sandbox 用，用 migration 移除；註解改寫 |
| `apps/ui/src/pages/AgentsPage.vue`、`apps/ui/src/stores/agents.ts`（`runtimeCmd`、`deploy`） | 拿掉 Sandbox 部署相關 UI 與 store |
| `apps/api/tests/agents.test.mjs` | 拿掉 sandbox 相關測試 |
| `agent-push.ts` 開頭講 sandbox-worker 代轉的註解 | 改寫 |
| `pnpm-lock.yaml` | 刪掉 workspace 後重新產生 |
| `migrations/0000_*`、`0006_agent_registry.sql` 與 snapshot | **保留**，migration 是歷史紀錄；移除欄位用新的 migration |
| `docs/sandbox-migration-todo.md` | 檔頭標「已廢棄，見 system-integration-design.md」，不刪（保留否決的理由） |

### 3.3 清掉 `agents/` 舊資料夾（Q5）

`agent-manager/agents/` 底下的 6 個資料夾（`jira-claude-cli-agent-2600010b` 這類帶 hash 後綴的名字：jira-claude-cli、jira-test、line-group、notion-claude-cli、railway-event、slack-reply）是舊模型的殘留，有的還帶著 AWS SDK 的 `node_modules`。**直接刪除**。它們沒有進 git（`git ls-files agents` 是 0 筆），只存在本機的主 checkout，所以是本機 `rm`，不是 PR 的一部分；順便把 `agents/` 加進 `.gitignore` 或確認已忽略。真正要留的 agent 從 agent-teammate 搬成腦袋 repo（§8 Phase 6）。

### 3.4 Routing Rule 的目標（Q20）

Routing Rule 多一個欄位選目標：

| 目標 | 行為 |
|---|---|
| **queue**（現狀） | 照舊，把 AgentEvent 丟進那條 queue；到 `PATCH /internal/events` 時跑 reply policy |
| **Workflow**（新） | 建一個 Run，把 entry 節點的 job 丟進該 agent 的 queue；reply policy 延到 Run 走到 `END` 才跑（§4.8） |

現有的規則不用搬。只有一個 agent 的情境繼續直接接 queue，不用包成一個節點的 Workflow。

---

## 4. 工作流層（照 LangGraph 的模型）

### 4.1 概念對應（Q2、Q7）

| LangGraph | 這裡 |
|---|---|
| `StateGraph` | **Workflow**，存在 PG，在工作流頁用 vue-flow 編輯 |
| node | **一個 agent**（它那條 queue）：殼 ＋ 腦袋 |
| edge ／ conditional edge | 依上一個節點的結果決定下一步（§4.4） |
| `START` | 經 Routing Rule 進來的 AgentEvent |
| `END` | 執行 reply policy，回覆來源平台 |
| state ＋ reducer | Run 的 `state`，合併規則見 §4.3 |
| checkpointer | 每走一步寫一筆 **Step** |
| `thread_id` | Run id |
| `interrupt()` ／ `interrupt_before` ／ `Command(resume=…)` | Run 狀態 `interrupted`；節點的 `interruptBefore`；人回覆後接續（§4.5） |
| `recursion_limit` | `maxSteps`（§4.6） |
| `RetryPolicy` | 節點重試（§4.7） |
| `Send`（fan-out）／ 合流 | **v1 不做**（Q15） |
| subgraph | v1 不做 |

**不引入 LangGraph 套件**：它是單一 process 內的 runtime，我們的節點是跨容器、跨 queue 的 agent。只借它的模型和名詞，引擎是 agent-manager 裡一段事件驅動的程式：收到某一步的結果 → 算下一步 → 丟下一個 job。

### 4.2 資料模型

```ts
// workflows：一張圖的身分
workflows         { id, ownerId, name, description, currentVersionId, createdAt, updatedAt }

// workflow_versions：每次存檔一版，內容不再改（Q19）
workflow_versions { id, workflowId, version, graph: jsonb, createdAt }

// workflow_runs：一次執行。固定在開始當下的版本
workflow_runs     { id, workflowId, versionId, originEventId, brokerId, ruleId,
                    replyTo,       // 已套用 rule.replyTarget 覆寫後的回覆目標
                    replyPolicy,   // 開始時從 Routing Rule 複製一份（JSON ReplyPolicy），END 時用
                    status,        // running | interrupted | done | failed | cancelled
                    currentNode, steps, state: jsonb, error, createdAt, updatedAt }

// workflow_steps：checkpoint，一步一筆，只新增（結果回來時補上 result 與結束時間）
workflow_steps    { id, runId, seq, node, eventId /* "wf_{runId}_{seq}"，每步唯一 */,
                    kind,          // run | retry | resume | gate
                    attempt,       // 同一次節點造訪的第幾次嘗試，retry 時遞增
                    status,        // queued | running | done | failed | interrupted
                    input, human /* resume 時人寫的回覆 */, result: jsonb, startedAt, endedAt }
```

**每次 enqueue 都是新的一步、新的 `seq`、新的 eventId**。BullMQ 用 eventId 當 `jobId` 而且保留已完成的 job（`removeOnComplete: 1000`），重用 eventId 會被當成重複而丟掉，所以重試和接續也不能沿用舊的 eventId。`kind` 說明這一步是怎麼來的：

| kind | 來源 | 算進 `maxSteps` |
|---|---|---|
| `run` | 照邊走到這個節點 | ✅ |
| `retry` | 暫時性錯誤自動重試（§4.7） | ❌ |
| `resume` | 中斷後人接續（§4.5） | ❌ |
| `gate` | 碰到 `interruptBefore` 停下來的紀錄（不丟 job） | ❌ |

`workflow_runs.steps` ＝ `kind=run` 的筆數。

`graph` 的格式：

```jsonc
{
  "entry": "dev",
  "maxSteps": 10,
  "nodes": [
    { "id": "dev",      "agentId": "agt_xxx", "input": "{{input.text}}" },
    { "id": "review",   "agentId": "agt_yyy", "input": "請 review {{nodes.dev.mrUrl}}\n\n{{nodes.dev.summary}}",
      "labels": ["approve", "changes"] },
    { "id": "deploy",   "agentId": "agt_zzz", "input": "部署 {{nodes.dev.mrUrl}}", "interruptBefore": true }
  ],
  "edges": [
    { "from": "dev",    "to": "review", "when": { "status": "done", "hasMrUrl": true } },
    { "from": "review", "to": "deploy", "when": { "label": "approve" } },
    { "from": "review", "to": "dev",    "when": { "label": "changes" } },
    { "from": "deploy", "to": "END" }
  ]
}
```

### 4.3 State：節點怎麼讀、怎麼寫（Q12）

agent 不知道自己在工作流裡，讀寫都由 agent-manager 代勞。

- **讀**：節點的 `input` 是一段範本，agent-manager 用 state 填好後當成 job 的 `payload.text`。可用的變數：`{{input.*}}`（原始事件的 payload）、`{{nodes.<id>.summary|mrUrl|status|label}}`、`{{human}}`（中斷後人寫的回覆）。
- **寫**：沿用 template 現有的 `result`：`status`、`summary`、`mrUrl`，加上 §5.6 補的 `costUsd`、`durationMs`、`numTurns`、`blocked[]`。
- **合併（reducer）**：

```ts
state = {
  input:   AgentEvent["payload"],             // 開始時寫入，之後不改
  nodes:   Record<nodeId, StepResult>,        // 同一節點再跑一次 → 新的蓋掉舊的
  history: StepResult[],                      // 每一步都往後加一筆，不蓋掉
}
```

### 4.4 條件邊（Q13）

`when` 只能判斷三種東西，在 UI 上用下拉選單設定，不寫程式：

| 條件 | 意思 |
|---|---|
| `status: "done" \| "failed"` | 上一步的結果 |
| `hasMrUrl: true \| false` | 結果裡有沒有 PR／MR 網址 |
| `label: "<值>"` | 節點設了 `labels` 時，agent-manager 在輸入最後附上一句：「最後一行寫 `結論：<approve\|changes>`」，再從 `summary` 把它解析出來 |

選邊的規則：同一個節點出去的邊**照順序比對，第一個符合的就走**；沒有 `when` 的邊永遠符合。都不符合時：上一步是 `done` 就當成走到 `END`，是 `failed` 就讓 Run 失敗。設了 `labels` 卻解析不到標籤，算這一步失敗。

### 4.5 中斷與接續（Q14）

**兩種情況會停下來：**

| 情況 | 怎麼觸發 |
|---|---|
| 自動中斷 | 結果裡 `blocked[]` 不是空的，代表 agent 在無人值守時碰到沒放行的動作。需要 template 把現在附在 summary 後面的「需要你核准才能繼續的動作」改成一個有結構的欄位（§5.6） |
| 手動關卡 | 節點設 `interruptBefore: true`，走到這個節點之前先停 |

停下來時 Run 變成 `interrupted`，在來源的 thread 貼一則「等待審查」，附 agent-manager 的連結。

**接續：**

- **回一段話**：在 agent-manager（或 template UI 轉送）寫回覆 → 把同一個節點重新丟進 queue，`{{human}}` 填入回覆。job 帶 `conversationKey = "wf:{runId}:{node}"`，template 用它接回同一個 Session（§5.6）。
- **核准被擋的動作**：**不能透過 queue 送權限**。job 是任何能寫 Routing Rule 的人都能影響的資料，讓它帶「這次放行 X」就等於把權限邊界交給呼叫方（同 executor 文件 §10.3 #4 的理由）。所以核准只有兩條路：
  1. agent-manager 的「核准」按鈕連到該 agent 的 template UI，**在那裡以有人值守模式接續那個 Session**，L4 動作停在待核准等人按；結束時 template 把結果回報給**同一個 step**
  2. 把 allow 規則寫進腦袋 repo 的 `.claude/settings.json`（git，有 review），下一次就不會再被擋
- **手動關卡**：走到 `interruptBefore` 的節點時寫一筆 `kind=gate` 的 step 就停下來；按「繼續」寫一筆 `kind=resume` 的 step 並丟 job。引擎判斷「這次是不是人放行的」就看：要 enqueue 的是不是 `resume`。

### 4.6 繞回與上限（Q16）

允許繞回前面的節點（例如 dev → review → dev）。每個 Run 有 `maxSteps`，預設 **10**，超過就讓 Run 失敗並通知。重試（§4.7）不算在步數裡。

### 4.7 失敗與重試（Q17）

| 情況 | 行為 |
|---|---|
| 暫時性錯誤：`result.unavailable === true`（用量／速率上限、overloaded、未登入、額度不足） | 自動重試，間隔逐次拉長（1 → 5 → 15 分鐘），最多 3 次；每次是一筆新的 `kind=retry` step，`attempt` 遞增 |

判斷暫時性錯誤的是 template，不是引擎：template 的 `report.ts` 已經用 `UNAVAILABLE` 這個 regex 把 heartbeat 設成 `error`，但現在 PATCH 的 `result` 沒有帶這個判斷結果。§5.6 #4 補一個 `unavailable` 欄位，引擎只讀欄位，不在兩邊各維護一份 regex。
| 其他失敗 | 不重試，照 `status: "failed"` 的邊走；沒有那條邊就讓 Run 失敗 |

### 4.8 回覆來源平台（Q18）

- 只有**走到 `END`** 才跑 reply policy，用最後一步的 `summary` 和 `mrUrl`，回覆對象是 Run 的 `replyTo`（開始時已套用 Routing Rule 的 `replyTarget`）
- 做法：現有的 `runReply()` 只從 `reply_contexts` 讀 policy。走到 `END` 時，引擎用 Run 的 `replyPolicy`、`brokerId`、`replyTo` 寫一筆 `reply_contexts`（eventId 用 `wf_{runId}_end`，避免和原始事件或其他 Run 撞 key），再呼叫 `runReply()`，不另寫一套回覆邏輯
- 中間的步驟不回覆，唯一例外是 §4.5 的「等待審查」
- Run 失敗時照 reply policy 的 `onFailure` 回覆

### 4.9 引擎流程

```
Routing Rule（目標＝Workflow）
  → 建 workflow_runs（固定 currentVersionId；複製 rule 的 replyPolicy、套用 replyTarget）
  → enqueue(entry, kind=run)

enqueue(node, kind, human?)：
  if kind=run 且 steps ≥ maxSteps → Run=failed，停
  if node.interruptBefore 且 kind≠resume → 寫 step(kind=gate, interrupted)；Run=interrupted，通知，停
  seq++；eventId = "wf_{runId}_{seq}"；寫 workflow_steps(queued)
  job = { eventId, brokerId, sourceType, eventType, payload: { text: 填好的 input, conversationKey }, replyTo, ts }
  丟進 node.agentId 的 queue（不建 reply_contexts；retry 用 BullMQ delay）

POST  /internal/agents/:id/events        { eventId, … }（agent 開始，per-agent token）
  eventId 是 "wf_" 開頭 → step=running；寫 agent_runs。不寫 webhook_events
  其他 → 照現狀更新 webhook_events；寫 agent_runs
PATCH /internal/agents/:id/events/:eventId { status, result }（agent 結束）
  寫 agent_runs 的結束狀態、成本、耗時
  eventId 是 "wf_" 開頭 → 交給引擎，不跑 reply policy：
    寫 step.result；合併 state
    result.unavailable 且 attempt<3 → enqueue(同一個 node, kind=retry)
    blocked[] 不是空的 → Run=interrupted，通知，停
    選邊 → 下一個 node 就 enqueue(kind=run)；是 END 就 Run=done，寫 reply_contexts 並 runReply()
  其他 → 照現狀跑 reply policy

POST /api/workflow-runs/:id/resume { message? } → enqueue(停下來的那個 node, kind=resume, human=message)
```

現有的 `POST /internal/events`、`PATCH /internal/events/:eventId` 保留給還沒升級的 agent，行為不變。

引擎和 queue 都在 agent-manager api 裡，不另開 service。「重新 enqueue 要延遲」用 BullMQ 的 `delay`。

### 4.10 API 與畫面

| API | 用途 |
|---|---|
| `GET/POST/PUT /api/workflows`、`GET /api/workflows/:id/versions` | 編輯圖；PUT 會產生新版本 |
| `GET /api/workflow-runs?status=…`、`GET /api/workflow-runs/:id` | Run 列表與明細（每一步的輸入、結果、成本） |
| `POST /api/workflow-runs/:id/resume { message? }` | 中斷後接續（§4.5） |
| `POST /api/workflow-runs/:id/cancel` | 取消 |
| `GET /internal/agents/:id/work` | 給 template UI 用，見 §5.5 |
| `POST /internal/agents/:id/events`、`PATCH /internal/agents/:id/events/:eventId` | agent 回報開始／結束，per-agent token，見 §6 |

**工作流頁**（取代現在的 Routing 頁，沿用 `@vue-flow/core`）：

- 左邊：Workflow 列表。中間：畫布，從右邊的 agent 清單把 agent 拖進來就是加一個節點，畫線就是加一條邊，點邊設 `when`。右邊：節點設定（輸入範本、labels、interruptBefore）
- Broker 和 Routing Rule 也畫在同一張畫布的左側，當成 `START`，可以看出「哪個 webhook 進哪個 Workflow 或哪條 queue」
- 下方：這個 Workflow 的 Run 列表，`interrupted` 的排最上面

**Agent 監控頁**（升級現在的 Agents 頁）：每個 agent 一張卡，內容見 §6。

---

## 5. Agent 層

### 5.1 殼與腦袋分開（取代 template ADR-0003）

template-claude-agent 的 repo 同時是：

1. **殼的原始碼**：`src/`、`Dockerfile`、`image/`、護欄 hook。build 出 `template-claude-agent:<版本>` 的 image
2. **預設腦袋**：通用開發 agent，也是腦袋 repo 的範例

ADR-0003 當初就預留了這個分岔：「第二個 agent 也要上雲時，得決定複製 Runtime 還是再抽成共用 base image」。現在選共用 base image，在 template repo 另寫 ADR-0007 取代 0003。

### 5.2 腦袋 repo（Q11）

- GitHub：`wpbawsed/{name}-agent`，private
- 本機 clone：`personal-developer-agent/repos/{name}-agent/`
- 內容只有腦袋：

```
{name}-agent/
├── CLAUDE.md、GOALS.md、CONTEXT.md、README.md
├── package.json            只用 name 當 agent 名稱
├── .claude/                settings.json、policy.json、hooks/、skills/（由 _utils/skill-store 發佈）
├── bin/
├── workspace/.gitkeep      :ro 掛載時要有這個掛載點
├── .env.example
└── Dockerfile              選用，只在需要額外工具鏈時才有（§5.4）
```

- template 加一支 `new-agent` 指令，產生這個骨架

### 5.3 腦袋怎麼進殼（Q8）

| 環境 | 做法 |
|---|---|
| docker（本機或雲端） | env 給 `AGENT_REPO`、`AGENT_REF`（branch）。容器啟動時 clone 到 volume；**之後每次從 queue 取 job 之前先 `git fetch` ＋ fast-forward** |
| 本機開發 | bind mount 本機的 checkout 到 `/agent`，不 pull（改了就生效） |

規則：

- **Run 進行中不 pull**，避免腦袋在半路換掉。網頁 UI 發起的 Run 也是在開始前 pull
- pull 失敗就沿用上一版，heartbeat 帶出警告（§6）
- 腦袋 repo 用 deploy key（唯讀），憑證只給 runtime，不傳給 Claude（template spec §6.1）
- 護欄仍然在 image 的 managed settings，換腦袋拿不掉（ADR-0006 不變）
- volume 只是快取，資料本體是 git（executor 文件 §11.1）；腦袋的 clone 和 workspace 分開放，pull 不會動到 workspace

### 5.4 工具鏈

base image 只放 node 22、git、python3、jq、ca-certificates。agent 需要其他工具（例如 sales-agent 的 bun、Go、某個 CLI）時，在腦袋 repo 放一個 Dockerfile：

```dockerfile
FROM ghcr.io/wpbawsed/template-claude-agent:<版本>
USER root
RUN …安裝額外工具…
USER agent
```

腦袋本身照樣用 git pull 更新；只有工具鏈改了才需要重新 build。

### 5.5 template UI 增加的區塊（Q9、Q10）

| 區塊 | 資料來源 |
|---|---|
| **我的工作** | `GET /internal/agents/:id/work`（用自己的 `AGENT_API_TOKEN`）：自己這條 queue 在等的、在跑的、最近完成的 job，加上卡在自己這個節點、等人審的 Workflow Run |
| **需要人的** | 現有的「待核准」（本機 L4）＋ 上面的 interrupted Run；點了就照 §4.5 接續 |
| **指標** | §6 那組，只看自己，加上今日已用額度（`policy.json` 的每日上限） |

不讀工作台卡片：重整期間線上的卡片只能讀不能寫（共同規範 #12），而且卡片和 queue 是兩套東西。沒有設定 agent-manager 時，UI 照現狀只顯示本機的待核准項目。

### 5.6 template 要改的地方

| # | 改什麼 | 為什麼 |
|---|---|---|
| 1 | `Dockerfile` 改成純殼：預設腦袋只在沒有 `AGENT_REPO` 也沒掛載時才用；entrypoint 處理 clone | §5.3 |
| 2 | consumer 取 job 前 `git fetch` ＋ fast-forward 腦袋 | §5.3 |
| 3 | job 的 `payload.conversationKey` 有值時，優先拿它當對話鍵 | §4.5 接續同一個 Session |
| 4 | 事件回報改打 `/internal/agents/:id/events`（用自己的 `AGENT_API_TOKEN`）；`result` 補上 `costUsd`、`numTurns`（`runOnce()` 已經存了）、`durationMs`（目前只在 stream 的 result 事件裡，`runOnce()` 沒存，要補）、`unavailable`（`report.ts` 的 regex 判斷結果） | §4.7、§6 |
| 5 | 被擋的動作除了附在 summary，也放進 `result.blocked[]`（`{ tool, summary }`） | §4.5 自動中斷 |
| 6 | heartbeat 帶上 `brainCommit` 和 `brainPullError` | §6 |
| 7 | UI 加「我的工作」「指標」 | §5.5 |
| 8 | 從 agent-manager 連過來時，能以有人值守模式接續某個 Session，結束時回報到原本的 step | §4.5 核准 |
| 9 | `new-agent` 指令 | §5.2 |
| 10 | `docs/spec.md` §2、§3、§12、§15 跟著改；ADR-0007 取代 0003 | — |

---

## 6. 指標與存活（Q10）

| 項目 | 判定或來源 |
|---|---|
| 存活 | `lastHeartbeatAt` 在 **90 秒內**就算活著（template 每 30 秒送一次，連漏 3 次才判定死掉）；超過顯示「失聯」 |
| 狀態 | heartbeat 的 `status`：`running` ／ `idle` ／ `error`（接不了工作，例如用量上限） |
| 腦袋版本 | heartbeat 的 `brainCommit`；`brainPullError` 有值就顯示警告 |
| queue 深度 | 直接問 BullMQ：waiting ＋ delayed |
| 24 小時成功／失敗、平均耗時、24 小時成本 | 新表 **`agent_runs`**（見下） |
| 記憶體、uptime | 現有的 `agent_metrics` |

**為什麼要新表**：`webhook_events` 不能拿來算 per-agent 指標。一個 webhook 只產生一個 eventId，比對到幾條 Routing Rule 就以同一個 eventId 丟進幾條 queue（`webhook.ts` 的 `jobId: eventId`），而 `webhook_events` 一個 eventId 只有一筆、沒有 agentId，多個 agent 回報時 `status` 會互相蓋掉。

```ts
// agent_runs：一個 agent 處理一個 event 一筆
agent_runs { id, agentId, eventId, status /* running | done | failed */,
             costUsd, durationMs, numTurns, error, startedAt, endedAt }
// unique(agentId, eventId)
```

- `POST /internal/events` 和 `PATCH /internal/events/:eventId` 認的是共用 token（`INTERNAL_TOKEN`，或全域的 `AGENT_API_TOKEN` env），agent-manager 不知道是哪個 agent 在回報。per-agent token（`agents.apiToken`）的驗證已經存在於 `/internal/agents/:id/*`（`agent-push.ts`），所以**新增 `POST /internal/agents/:id/events` 和 `PATCH /internal/agents/:id/events/:eventId`**，agentId 由 token 驗證而不是 body 自報，寫入 `agent_runs`
- `webhook_events` 維持記錄「webhook 進來那一刻」的稽核用途；`wf_` 的 step 不寫進去（舊的 POST 會替沒看過的 eventId 插一筆 `ownerId: "unknown"`，新路由不做這件事）

**agent-manager 要改的地方**（Phase 4）：

| 位置 | 改什麼 |
|---|---|
| `agent-push.ts` heartbeat | 現在 `idle` 會被併成 `running`，Fastify schema 也會刪掉沒宣告的欄位。改成保留 `running`／`idle`／`error` 三態，schema 加 `brainCommit`、`brainPullError` |
| `agents` 表 | 加 `brain_commit`、`brain_pull_error` 欄位；`status` 的值域加 `idle` |
| 新路由 | 上面的 `/internal/agents/:id/events` |

Agent 監控頁的每張卡：名稱、腦袋 repo ＋ commit、狀態燈、最後一次 heartbeat、queue 深度、24 小時成功／失敗、平均耗時、24 小時成本、目前跑的是哪個 Workflow 的哪一步。

---

## 7. 部署（Q4）

**這一階段：本機 docker compose。**

```yaml
# agent-manager/docker-compose.yml 現有的 postgres、redis、api、ui 之外
# 每個 agent 一個 service（或放在另一個 compose 檔，用同一個網路）
agent-personal-developer:
  image: ghcr.io/wpbawsed/template-claude-agent:<版本>
  env_file: ~/.agents/personal-developer.env   # 放在 repo 外面（template README 的理由）
  environment:
    AGENT_REPO: git@github.com:wpbawsed/personal-developer-agent.git
    AGENT_REF: main
    AGENT_MANAGER_URL: http://api:8080
    REDIS_URL: redis://redis:6379
  volumes:
    - personal-developer-ws:/agent/workspace
```

**之後：Railway**。同一個 image，一個 agent 一個 service（executor 文件 §11.2），env 照搬，workspace 掛 Railway volume。本文不驗收 Railway。

---

## 8. 遷移計畫

每個 Phase 各自一個 branch 和 PR，順序如下。

| Phase | 內容 | 完成的定義 |
|---|---|---|
| **0** | 本文件 ＋ template ADR-0007 | 合併 |
| **1 介接層** | broker-core 搬進 `packages/`、刪 sandbox-worker（§3.2）、修 README 的過時 Packages 表（`packages/node-agent` 早就不存在）；本機另外 `rm` 掉 `agents/`（§3.3，不在 PR 裡） | `pnpm -r test` 全過；webhook → queue → reply 本機跑通；agent-broker README 改好 |
| **2 殼** | template §5.6 #1–#6、#9 | 同一個 image 換兩個不同的腦袋 repo 都跑得起來；push 腦袋 repo 後，下一個 job 跑的是新版；preflight 過 |
| **3 試點** | personal-developer 搬成 `wpbawsed/personal-developer-agent`，接上 agent-manager | webhook → agent-manager → queue → 殼 ＋ 腦袋 → 回覆，端到端跑通 |
| **4 工作流層** | 資料模型、引擎、API、工作流頁、Agent 監控頁、`agent_runs`、per-agent 事件路由、heartbeat 三態與腦袋版本（§4、§6） | 兩個節點的 Workflow 跑通：條件邊、label、中斷 ＋ 接續、`maxSteps`、重試 |
| **5 Agent UI** | template §5.6 #7、#8 | UI 看得到我的工作、指標；能從 agent-manager 連過來核准 |
| **6 其餘 agent** | agent-teammate 剩下的 8 個 app，一次搬一個，每個搬之前個別決定（sales-agent 排第二批，對話接續已有 `conversations.ts`） | agent-teammate README 標示凍結 |

Phase 1 和 Phase 2 互不依賴，可以同時進行；Phase 3 需要兩者都完成；Phase 4 只依賴 Phase 1，可以和 Phase 2、3 同時進行；Phase 5 需要 Phase 4 的 `/internal/agents/:id/work`。

---

## 9. 取代或修正的舊決策

| 舊決策 | 在哪 | 現在 |
|---|---|---|
| 「Runtime 跟著 Agent 資料夾走，不抽成共用 image」 | template ADR-0003 | 由 ADR-0007 取代：共用殼 ＋ 腦袋 repo |
| §12「每個 agent 自帶 runtime，用同步工具把 runtime 推給各 agent」 | `executor-placement-decision.md`（在 branch `docs/executor-placement-decision`，尚未合併） | 取代：runtime 只有一份（殼），不需要同步工具 |
| §9.3「固定 image ＋ agent 當資料」 | 同上 | 回到這個方向，但腦袋用 git pull 取得（§11.1 的可行解法），一個 agent 一個 service（§11.2 維持） |
| §10.1「推進圖放 cloud-workbench（D1 ＋ Workers Cron）」 | 同上 | 改成放 agent-manager。工作流頁要和 Broker／Queue／Agent 畫在一起，而且推進的觸發點（agent 結果回報）本來就打到 agent-manager |
| Phase 5「一個 app 一個 Railway service」、Layer B ＝ agent-teammate | `agent-teammate/docs/INITIALIZATION_PLAN.md` | agent-teammate 凍結；Layer B 改成「殼 ＋ 各腦袋 repo」 |
| Cloudflare Sandbox | `sandbox-migration-todo.md` | 2026-07-04 已否決；這次把程式碼也清掉 |

---

## 10. 這一階段不做

| 項目 | 原因 |
|---|---|
| 平行分支、合流（`Send`）、subgraph | Q15。要處理「等齊所有分支」和平行寫 state，等真的需要再做 |
| 條件邊寫任意 JS 運算式 | Q13。只給下拉選單能表達的三種條件 |
| 透過 queue 送權限 | §4.5，權限邊界不交給呼叫方 |
| Railway 驗收 | Q4。同一個 image，只換部署參數 |
| 一個 process 服務多個 agent（多 queue、agentId 從 event 來） | 一個 agent 一個 service 是設計本意（executor 文件 §11.2） |
| 第三方 agent SDK | Q3。真的需要再從 template 的 consumer 抽 |
| 自動註冊 agent 到 agent-manager | 手動建一筆就夠（template spec §15） |

---

## 11. 動工前要確認的事實

已查證（2026-10-29，agent-manager `origin/main` 671f010；template `origin/dev`）：

- `POST /internal/events` 以 eventId upsert `webhook_events`，`PATCH` 只改 `status` 再跑 reply policy；兩者都只認共用 token，沒有 agentId → 所以 §6 另開 `agent_runs` 與 per-agent 的事件路由
- heartbeat 把 `idle` 併成 `running`，schema 會刪掉沒宣告的欄位 → §6 列為要改
- template 的護欄 image（`image/`、`/etc/claude-code`、ADR-0006）在 template 的 `dev` branch，尚未進 `main`
- 一個 webhook 分流到多條 queue 時共用同一個 eventId（`webhook.ts`：`jobId: eventId`）→ 多個 agent 的 PATCH 會對同一個 eventId 跑 reply policy；`reply_contexts` 一個 eventId 一筆，回覆後刪掉，所以實際只回一次，先到先回。Workflow 的 step 各有自己的 `wf_` eventId，不受影響

還沒查證：

| # | 事實 | 影響 |
|---|---|---|
| 1 | template 在有人值守模式接續 queue 發起的 Session 時，回報能否指定原本的 eventId | §5.6 #8 |
| 2 | Slack 回覆沒帶 `thread_ts`（template spec §12.3 記錄的 agent-manager 待修項） | Run 的「等待審查」與最終回覆要回到同一個 thread，Phase 4 前要修 |
