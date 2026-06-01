# Agent Manager — 需求文件

## 背景與問題

### 問題起源

隨著 AI Agent 的使用場景從個人工具擴展到團隊基礎設施，現有工具組合（VSCode + PM2 + 各種 CLI）有幾個根本限制：

1. **可觀測性依賴 Agent 自己回報**：Agent 掛掉時無法得知原因，因為回報機制本身也失效了
2. **沒有統一的控制平面**：啟動、停止、設定分散在不同工具，非技術人員無法操作
3. **事件路由與 Agent 管理是分離的**：Broker 負責路由但不知道 Agent 是否存活；Agent 存活但不知道事件從哪來
4. **多人使用缺乏隔離**：每個使用者應該只看到自己的 Agent，彼此互不干擾

### 核心洞察

原本的 Agent Broker（事件路由層）與 Agent Manager（生命週期控制層）拆開是錯的。Broker 單獨存在太輕，Queue 只是傳遞機制，不應作為獨立服務的核心。

**正確的抽象是：Agent Manager 是主體，Queue 是它的內部實作細節。**

可觀測性的正確位置在 Worker 層（事件的入口），而不是 Agent 層。這樣即使 Agent 掛掉，事件流向記錄依然完整。Agent 本身的執行 Log 也要能在 UI 上顯示，讓使用者不需要看 terminal。

---

## 目標

### 主要目標

建立一個統一的 Agent 管理平台，讓使用者可以：

- 定義並管理自己的 AI Agent（instruction、skill、MCP、memory）
- 透過 UI 啟動、停止 Agent
- 設定事件來源（Slack、Jira），並視覺化看到 Broker → Agent 的連線關係
- 在 UI 上看到完整的事件 Log 與 Agent 執行 Log
- 多人使用，每個帳號只看到自己的 Agent

### 次要目標

- 提供 Playground 讓使用者在部署前直接測試 Agent 行為
- 提供 Memory 管理功能，讓 Agent 跨 session 保留知識

---

## 使用者角色

### Agent Owner（一般使用者）
- 建立並管理自己的 Agent
- 設定 instruction、skill、MCP、memory
- 查看自己 Agent 的 Log 與狀態
- 設定 Broker 連線（Slack / Jira）
- 在 Playground 測試 Agent

### Platform Admin
- 查看所有使用者的 Agent 狀態（不看內容）
- 強制停止異常 Agent
- 管理帳號

---

## Agent 形態

Agent 本身可以是以下任一形態，平台不限定：

- **Claude Code CLI process**：`claude -p "..."` non-interactive mode，由 Node Agent 的 polling loop 驅動
- **自己寫的 script**：Node.js / Python 等，自行實作 LLM 呼叫與 tool execution

平台只定義 Agent 跟平台的溝通介面（消費 Queue、寫入 Log），內部實作由使用者決定。平台不提供 LLM，使用者自帶 API Key。

---

## 部署演進路線

### v1 — 本機一體化（當前目標）

所有服務跑在使用者自己的電腦上。Cloudflare Workers + Queues 仍在雲端負責接收外部 webhook。

```
雲端：Cloudflare Workers → Cloudflare Queue
                                  ↓ HTTP Pull
使用者本機（docker compose）：
  ├── UI + API Server
  └── Node Agent
        ├── Agent Runtime A（claude -p 或自訂 script）
        └── Agent Runtime B
```

- API Server 透過 Node Agent 直接管理同機器上的 Agent process
- UI 可以完整控制 Agent 的啟動 / 停止
- 不需要跨機器控制通道

### v2 — 平台 VM，Manager 與 Agent 同機（後續）

整包搬到平台提供的 VM，架構與 v1 相同，只是機器變成平台管理的。多個使用者的 Agent 跑在同一台 VM 上。

```
平台 VM：
  ├── UI + API Server
  └── Node Agent
        ├── 使用者 A 的 Agent Runtime
        └── 使用者 B 的 Agent Runtime
```

### v3 — 平台 VM，Manager 與 Agent 分開（後續）

規模擴大後，UI + API Server 與 Agent Runtime 分佈在不同機器。每台 Agent 機器跑一個 Node Agent daemon，API Server 透過 HTTP 或 WebSocket 與各台機器的 Node Agent 溝通。

```
控制平面 VM：UI + API Server
                  ↕ HTTP polling 或 WebSocket
Agent VM 1：Node Agent → Agent Runtime A, B
Agent VM 2：Node Agent → Agent Runtime C, D
```

Node Agent 的職責：
- 接受 API Server 指令（啟動 / 停止 Agent）
- 管理本機 process 生命週期（spawn / kill）
- 收集 stdout / stderr 回傳 Log
- 定期回報機器健康狀態

類比：Kubernetes 的 Control Plane → kubelet → Container，但輕量化。

---

## 不做的事（明確排除）

- **不提供 LLM**：平台不提供也不管理 LLM 用量，使用者自帶 API Key
- **不做 Agent 內容審查**：只觀察行為異常（呼叫頻率），不看對話內容
- **不鎖定特定 LLM**：Agent 用什麼 model 是 owner 自己決定的

---

## 關鍵決策記錄

### 為什麼選 Cloudflare Workers + Queues

| 考量 | AWS Lambda + SQS | Cloudflare Workers + Queues |
|---|---|---|
| Cold start | 有（毫秒到秒級） | 幾乎零 |
| Egress 費用 | 有 | 無 |
| Agent Runtime 耦合 | 強 | 弱（HTTP Pull，任何地方皆可） |
| 費用（中小規模） | 相近 | 略低 |

### 為什麼 Broker 和 Manager 要合併

- Broker 單獨存在服務太輕，核心價值在 Queue 本身
- 可觀測性依賴 Agent 回報是壞設計
- 兩個服務各自維護 Agent Registry 容易不同步

### 為什麼需要 Node Agent 這一層

直接由 API Server 管理 process 在 v1 可行，但無法擴展到 v3（跨機器）。Node Agent 作為每台機器上的 daemon，統一了 v1/v2/v3 的 process 管理介面，讓 API Server 的控制邏輯不需要隨部署模式改變。

### Log 儲存策略

- **Worker 層**寫入事件 Log（不依賴 Agent，記錄事件進出）
- **Agent 透過 Node Agent** 將 stdout / stderr 回傳平台
- **Cloudflare D1** 作為主要儲存
- **Cloudflare KV** 作為 Worker routing table 快取

---

## 成功標準（v1 MVP）

- [ ] 使用者可以 `docker compose up` 啟動整個平台
- [ ] 可以在 UI 建立 Agent，設定 instruction
- [ ] UI 按啟動後，Agent process 在本機真正跑起來
- [ ] UI 按停止後，Agent process 真正結束
- [ ] Agent 執行 Log 在 UI 即時可見
- [ ] 可以在 UI 新增 Slack Broker，事件進 Queue 後 Agent 收到並處理
- [ ] 可以視覺化看到 Broker → Agent 的連線狀態
- [ ] 兩個不同帳號的 Agent 互不干擾
