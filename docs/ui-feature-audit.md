# UI Feature Audit — agent-manager
> 產出時間：2026-06-02  
> 對比對象：`packages/ui/src/pages/` vs `docs/ui-redesign.html`

---

## 一、現有 UI 功能清單

### 🔐 Auth
| 功能 | 狀態 |
|---|---|
| Login（email + password） | ✅ |
| Register（email + password） | ✅ |
| JWT token 自動附帶（axios interceptor） | ✅ |
| 登出 | ✅ |

---

### 🤖 Agents 頁面
| 功能 | 狀態 | 備注 |
|---|---|---|
| Agent 列表（名稱 / Queue / 狀態 / Instruction preview） | ✅ | |
| 統計卡：Total / Running | ✅ | |
| 新增 Agent（名稱 + Queue selector + instruction） | ✅ | |
| 啟動 / 停止 Agent | ✅ | |
| 進入詳細頁 | ✅ | |

---

### 🤖 Agent 詳細頁（AgentDetailPage）

#### 概覽 Tab
| 功能 | 狀態 | 備注 |
|---|---|---|
| 顯示 ID / Status / Queue ID | ✅ | |
| 編輯名稱 / 描述 | ✅ | |
| 編輯 Runtime Type / Runtime CMD | ✅ | ⚠️ 舊欄位，新架構不需要 |
| 刪除 Agent（危險區域） | ✅ | |

#### Instruction Tab
| 功能 | 狀態 | 備注 |
|---|---|---|
| 編輯 CLAUDE.md（即時 debounce 自動儲存） | ✅ | |
| Raw / Markdown Preview 切換 | ✅ | |

#### 日誌 Tab
| 功能 | 狀態 | 備注 |
|---|---|---|
| SSE 即時 log stream | ✅ | |
| 依 level 著色（error=紅、info=綠） | ✅ | |

#### Docs Tab
| 功能 | 狀態 | 備注 |
|---|---|---|
| 文件列表（file browser） | ✅ | |
| 新建文件（輸入檔名） | ✅ | |
| 編輯（Raw textarea / Markdown preview） | ✅ | |
| 儲存 / 刪除 | ✅ | |

#### Skills Tab
| 功能 | 狀態 | 備注 |
|---|---|---|
| Skill 樹狀列表（展開/收合） | ✅ | |
| 新建 Skill（name / description / trigger / instructions） | ✅ | |
| Upload Skill（.md drag & drop） | ✅ | |
| 重新命名 Skill | ✅ | |
| 刪除 Skill | ✅ | |
| 查看/編輯 Skill 檔案（raw / preview） | ✅ | |
| SKILL.md metadata panel（name/description/trigger） | ✅ | |

#### Variables Tab
| 功能 | 狀態 | 備注 |
|---|---|---|
| Key-Value 環境變數（新增 / 移除 / auto-save） | ✅ | |

#### MCP Tab
| 功能 | 狀態 | 備注 |
|---|---|---|
| MCP Server 列表 | ✅ | |
| 新增 Server（name / command / args / env / description） | ✅ | |
| 編輯 Server | ✅ | |
| 刪除 Server | ✅ | |

#### Repos Tab
| 功能 | 狀態 | 備注 |
|---|---|---|
| Repo 列表 | ✅ | |
| Clone Repo（URL + name + description） | ✅ | |
| 刪除 Repo | ✅ | |

---

### 📬 Queues 頁面
| 功能 | 狀態 | 備注 |
|---|---|---|
| Queue 列表（名稱 / 描述 / ID） | ✅ | |
| 新增 Queue（name + description） | ✅ | |
| 刪除 Queue（含確認提示） | ✅ | |

---

### 🔌 Brokers 頁面
| 功能 | 狀態 | 備注 |
|---|---|---|
| Broker 列表 | ✅ | |
| 新增 Broker（Slack / Jira / Notion） | ✅ | |
| Jira 專屬欄位（Project Keys / Filter Account ID） | ✅ | |
| Provider 憑證注入（requiredVars，secret 欄位遮罩） | ✅ | |
| 啟用 / 停用 Broker | ✅ | |
| 顯示 Webhook URL + 複製 | ✅ | |
| 編輯 Broker（名稱 + Jira config） | ✅ | |

---

### 🔀 Routing 頁面
| 功能 | 狀態 | 備注 |
|---|---|---|
| Vue Flow 三欄視覺化（Broker → Queue → Agent） | ✅ | |
| 新增路由規則（名稱 / Broker / Queue / eventTypes / replyTarget） | ✅ | |
| eventTypes 多選（含常用 hint + 自由輸入） | ✅ | |
| 刪除規則（含確認） | ✅ | |
| 規則列表（右側面板） | ✅ | |

---

### 📋 Logs 頁面
| 功能 | 狀態 | 備注 |
|---|---|---|
| Agent 執行日誌（Filter by Agent + Level） | ✅ | |
| SSE 即時串流開關 | ✅ | |
| 即時 log 渲染（terminal 樣式） | ✅ | |
| 歷史 log 列表（n-data-table） | ✅ | |
| 事件日誌（Workers/D1） | ⚠️ 佔位符 | 尚未實作查詢 |

---

### 🧪 Playground 頁面
| 功能 | 狀態 | 備注 |
|---|---|---|
| 選擇 Agent | ✅ | |
| Chat 對話介面（user / assistant 泡泡） | ✅ | |
| SSE 串流打字效果 | ✅ | |
| 清除對話記錄 | ✅ | |
| Shift+Enter 換行 | ✅ | |
| 右側 context panel（Queue / agent info） | ✅ | |

---

### ⚙️ Admin 頁面（admin only）
| 功能 | 狀態 | 備注 |
|---|---|---|
| 使用者列表 | ✅ | |
| 修改角色（owner / admin / user） | ✅ | |
| 修改密碼 | ✅ | |

---

## 二、UI vs 設計文件（ui-redesign.html）差異分析

### ✅ 設計有、UI 也有（對齊）
- 基本 CRUD：Agents / Queues / Brokers / Routing / Logs / Playground / Admin
- Routing：Vue Flow 視覺化（設計文件已更新為新架構）
- Queue 是獨立實體（eventTypes 過濾，非 Conditions JSON）
- Agent 建立只需 Name + Queue + Instruction

### 🔴 UI 有、設計文件完全沒提到（UI 超前設計）
| 功能區塊 | 說明 |
|---|---|
| **Agent Detail → Skills Tab** | Skill 樹狀管理、Create/Upload/Rename、file browser + SKILL.md metadata |
| **Agent Detail → Docs Tab** | 文件管理（Markdown editor + preview） |
| **Agent Detail → Variables Tab** | Key-Value 環境變數 auto-save |
| **Agent Detail → MCP Tab** | MCP Server 完整 CRUD（name/command/args/env） |
| **Agent Detail → Repos Tab** | Git Repo Clone / Delete |
| **Brokers → requiredVars** | 建立 Broker 時注入 provider 憑證（JIRA_API_TOKEN 等）|
| **Brokers → Edit** | Broker 名稱 + Jira project keys 編輯 |
| **Logs → SSE Stream** | 即時串流開關 + terminal view |
| **Playground → SSE 打字效果** | 串流輸出而非一次回傳 |

### 🟡 設計文件有、UI 尚未完整實作（設計超前 UI）
| 項目 | 設計文件描述 | 目前狀態 |
|---|---|---|
| **Agents 頁面統計** | 4 個 stat card（Total / Running / Jobs Today / Errors 24h） | 只有 2 個（Total / Running） |
| **Logs → 事件日誌（Workers）** | D1 查詢介面 | `<n-empty>` 佔位符，尚未實作 |
| **Admin → 統計卡** | Total Users / Total Agents / Webhook Events 7d | 目前 Admin 頁只有 user 列表，無統計 |
| **Routing → replyTarget 說明** | 設計有 info banner 解釋 replyTarget 概念 | UI 的 RoutingPage 表單有欄位但沒說明 banner |

### ⚠️ 技術負債（需要清除的舊欄位）
| 位置 | 問題 | 建議 |
|---|---|---|
| `AgentDetailPage` — 概覽 Tab | 仍有 `runtimeType` / `runtimeCmd` 編輯欄位，新架構已不需要 | 移除，改顯示 Queue 連結 |
| `AgentDetailPage` — 頂部 title | 顯示 `agent?.runtimeType` tag | 改顯示 Queue name |

---

## 三、更版優先級建議

### P0（本次更版）
1. 清除 AgentDetailPage 舊欄位（runtimeType / runtimeCmd）→ 改為 Queue 選擇

### P1（近期補齊）
2. Agents 頁面補齊 4 個統計卡（Jobs Today / Errors 24h 需 backend 支援）
3. Routing 頁面加 replyTarget info banner
4. Admin 頁面加統計卡

### P2（中期）
5. Logs → Workers 事件日誌 D1 查詢介面
