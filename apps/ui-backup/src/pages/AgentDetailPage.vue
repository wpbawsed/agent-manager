<template>
  <div>
    <!-- Back + Header -->
    <n-space align="center" style="margin-bottom: 16px;">
      <n-button text @click="router.back()">&#x2190; &#x8FD4;&#x56DE;</n-button>
      <n-h3 style="margin: 0;">
        {{ agent?.name ?? '...' }}
        <n-tag v-if="agent?.queueId" size="small" type="info" :bordered="false" style="margin-left: 8px;">
          Queue: {{ agent.queueId }}
        </n-tag>
      </n-h3>
      <n-space>
        <n-button
          v-if="agent?.status !== 'running'"
          type="primary"
          size="small"
          :loading="actionLoading"
          @click="handleStart"
        >&#x555F;&#x52D5;</n-button>
        <n-popconfirm v-else @positive-click="handleStop">
          <template #trigger>
            <n-button type="warning" size="small" :loading="actionLoading">&#x505C;&#x6B62;</n-button>
          </template>
          &#x78BA;&#x8A8D;&#x505C;&#x6B62;&#x6B64; Agent&#xFF1F;
        </n-popconfirm>
      </n-space>
    </n-space>

    <!-- Tabs -->
    <n-tabs v-model:value="activeTab" type="line" animated @update:value="onTabChange">
      <!-- ── Overview ── -->
      <n-tab-pane name="overview" tab="概覽">
        <!-- Read-only info -->
        <n-descriptions :column="2" bordered label-placement="left" size="small" style="margin-bottom: 24px;">
          <n-descriptions-item label="ID">{{ agent?.id }}</n-descriptions-item>
          <n-descriptions-item label="Status">
            <n-badge
              :type="agent?.status === 'running' ? 'success' : agent?.status === 'error' ? 'error' : 'default'"
              :processing="agent?.status === 'running'"
            >
              {{ agent?.status }}
            </n-badge>
          </n-descriptions-item>
          <n-descriptions-item label="Queue ID" :span="2">{{ agent?.queueId ?? '—' }}</n-descriptions-item>
        </n-descriptions>

        <!-- Edit form -->
        <n-card title="設定" size="small" style="margin-bottom: 24px;">
          <n-form :model="editForm" label-placement="top" style="max-width: 560px;">
            <n-form-item label="名稱">
              <n-input v-model:value="editForm.name" placeholder="my-agent" />
            </n-form-item>
            <n-form-item label="描述">
              <n-input v-model:value="editForm.description" placeholder="（選填）" />
            </n-form-item>
            <n-form-item>
              <n-button type="primary" :loading="editSaving" @click="saveAgentEdit">儲存設定</n-button>
            </n-form-item>
          </n-form>
        </n-card>

        <!-- Danger zone -->
        <n-card title="危險區域" size="small" :bordered="true" style="border-color: #ff4d4f20;">
          <n-space align="center">
            <n-text depth="3" style="font-size: 13px;">刪除此 Agent 將會移除所有相關資料，此操作不可還原。</n-text>
            <n-popconfirm @positive-click="handleDelete">
              <template #trigger>
                <n-button type="error" size="small">刪除 Agent</n-button>
              </template>
              確認刪除此 Agent？此操作不可還原。
            </n-popconfirm>
          </n-space>
        </n-card>
      </n-tab-pane>

      <!-- ── Instruction (CLAUDE.md) ── -->
      <n-tab-pane name="instruction" tab="Instruction">
        <n-space justify="space-between" align="center" style="margin-bottom: 8px;">
          <n-text depth="3" style="font-size: 12px;">CLAUDE.md &#x2014; &#x4FEE;&#x6539;&#x5F8C;&#x81EA;&#x52D5;&#x5132;&#x5B58;</n-text>
          <n-tag v-if="claudeMdSaved" type="success" size="small" :bordered="false">&#x5DF2;&#x5132;&#x5B58;</n-tag>
          <n-tag v-else-if="claudeMdSaving" type="warning" size="small" :bordered="false">&#x5132;&#x5B58;&#x4E2D;...</n-tag>
        </n-space>
        <n-input
          v-model:value="claudeMdContent"
          type="textarea"
          :rows="24"
          placeholder="&#x8F09;&#x5165;&#x4E2D;..."
          style="font-family: monospace; font-size: 13px;"
          @update:value="debounceSaveClaudeMd"
        />
      </n-tab-pane>

      <!-- ── Logs ── -->
      <n-tab-pane name="logs" tab="日誌">
        <div
          ref="logContainerRef"
          class="log-stream-container"
        >
          <div
            v-for="(line, i) in logLines"
            :key="i"
            :style="{ color: line.level === 'error' ? '#ff6b6b' : '#a8ff78' }"
          >
            <span style="color: #666; margin-right: 8px; user-select: none;">{{ formatLogTime(line.ts) }}</span>{{ line.msg }}
          </div>
          <div v-if="logLines.length === 0" style="color: #555;">等待日誌...</div>
        </div>
      </n-tab-pane>

      <!-- ── Docs ── -->
      <n-tab-pane name="docs" tab="Docs">
        <div class="file-editor-layout">
          <!-- Left: file list -->
          <div class="file-list-panel">
            <div class="file-list-header">
              <span class="file-list-label">DOCS</span>
              <n-button size="tiny" type="primary" ghost @click="openDocCreate">+ New</n-button>
            </div>
            <div
              v-for="doc in docs" :key="doc"
              class="file-list-item"
              :class="{ active: docFilename === doc && docPaneOpen }"
              @click="openDocEdit(doc)"
            >
              <span class="file-icon">&#x1F4C4;</span>
              <span class="file-name">{{ doc }}</span>
            </div>
            <div v-if="docs.length === 0" class="file-list-empty">&#x5C1A;&#x7121;&#x6587;&#x4EF6;</div>

            <!-- new file input -->
            <div v-if="docCreating" class="file-new-input">
              <n-input
                v-model:value="docFilename"
                size="small"
                placeholder="filename.md"
                autofocus
                @keyup.enter="confirmDocCreate"
                @keyup.escape="docCreating = false"
              />
            </div>
          </div>

          <!-- Right: editor -->
          <div class="file-editor-panel">
            <template v-if="docPaneOpen">
              <div class="file-editor-topbar">
                <span class="file-editor-filename">{{ docFilename }}</span>
                <div class="file-editor-actions">
                  <n-button-group size="small">
                    <n-button :type="docViewMode === 'raw' ? 'primary' : 'default'" @click="docViewMode = 'raw'">Raw</n-button>
                    <n-button :type="docViewMode === 'preview' ? 'primary' : 'default'" @click="docViewMode = 'preview'">Markdown</n-button>
                  </n-button-group>
                  <n-popconfirm @positive-click="deleteDocAndClose">
                    <template #trigger>
                      <n-button size="small" type="error" ghost>&#x522A;&#x9664;</n-button>
                    </template>
                    &#x78BA;&#x8A8D;&#x522A;&#x9664; {{ docFilename }}&#xFF1F;
                  </n-popconfirm>
                  <n-button size="small" type="primary" :loading="savingDoc" @click="saveDoc">Save</n-button>
                </div>
              </div>
              <div class="file-editor-body">
                <n-input
                  v-if="docViewMode === 'raw'"
                  v-model:value="docContent"
                  type="textarea"
                  :autosize="false"
                  style="height: 100%; font-family: monospace; font-size: 13px;"
                />
                <div
                  v-else
                  class="markdown-preview"
                  v-html="renderMarkdown(docContent)"
                />
              </div>
            </template>
            <div v-else class="file-editor-empty">Select a file from the sidebar to view it.</div>
          </div>
        </div>
      </n-tab-pane>

      <!-- ── Skills ── -->
      <n-tab-pane name="skills" tab="Skills">
        <div class="file-editor-layout">
          <!-- Left: skill tree -->
          <div class="file-list-panel">
            <div class="file-list-header">
              <span class="file-list-label">SKILLS</span>
              <n-dropdown trigger="click" :options="newSkillMenuOptions" @select="handleNewSkillMenu">
                <n-button size="tiny" type="primary" ghost>+ New</n-button>
              </n-dropdown>
            </div>

            <div v-if="skills.length === 0" class="file-list-empty">尚無 Skill</div>

            <template v-for="skill in skills" :key="skill">
              <!-- Skill root row -->
              <div
                class="skill-root-row"
                :class="{ active: selectedSkill === skill && selectedFilePath === '' }"
                @click="toggleSkillExpand(skill)"
              >
                <span class="tree-caret">{{ expandedSkills.has(skill) ? '▾' : '▸' }}</span>
                <span class="skill-icon">⊞</span>
                <span class="skill-root-name">{{ skill }}</span>
                <n-dropdown
                  trigger="click"
                  :options="skillActionOptions"
                  @select="(k) => handleSkillAction(k, skill)"
                  @click.stop
                >
                  <n-button size="tiny" text class="skill-more-btn">⋯</n-button>
                </n-dropdown>
              </div>

              <!-- Tree nodes when expanded -->
              <template v-if="expandedSkills.has(skill)">
                <div
                  v-for="node in flattenSkillTree(skill)"
                  :key="skill + '/' + node.path"
                  class="skill-tree-node"
                  :class="{
                    active: selectedSkill === skill && selectedFilePath === node.path,
                    'is-dir': node.type === 'dir',
                  }"
                  :style="{ paddingLeft: (node.depth * 16 + 28) + 'px' }"
                  @click="node.type === 'dir' ? toggleSubDir(skill, node.path) : openSkillFile(skill, node.path)"
                >
                  <span v-if="node.type === 'dir'" class="tree-caret" style="margin-right: 4px;">
                    {{ expandedSubDirs.has(skill + '/' + node.path) ? '▾' : '▸' }}
                  </span>
                  <span class="node-icon">{{ node.type === 'dir' ? '📁' : '📄' }}</span>
                  <span class="node-name">{{ node.name }}</span>
                </div>
              </template>
            </template>
          </div>

          <!-- Right: file editor -->
          <div class="file-editor-panel">
            <template v-if="selectedSkill && selectedFilePath">
              <div class="file-editor-topbar">
                <span class="file-editor-filename">{{ selectedSkill }} / {{ selectedFilePath }}</span>
                <div class="file-editor-actions">
                  <n-button-group size="small">
                    <n-button :type="fileViewMode === 'raw' ? 'primary' : 'default'" @click="fileViewMode = 'raw'">Raw</n-button>
                    <n-button :type="fileViewMode === 'preview' ? 'primary' : 'default'" @click="fileViewMode = 'preview'">Preview</n-button>
                  </n-button-group>
                  <n-popconfirm @positive-click="doDeleteSkillFile">
                    <template #trigger>
                      <n-button size="small" type="error" ghost>刪除</n-button>
                    </template>
                    確認刪除 {{ selectedFilePath }}？
                  </n-popconfirm>
                  <n-button size="small" type="primary" :loading="savingFile" @click="saveSkillFile">Save</n-button>
                </div>
              </div>

              <!-- Metadata panel for SKILL.md in preview mode -->
              <div v-if="selectedFilePath === 'SKILL.md' && fileViewMode === 'preview' && (skillMeta.description || skillMeta.name || skillMeta.trigger)" class="skill-meta-panel">
                <div v-if="skillMeta.name" class="skill-meta-row">
                  <span class="skill-meta-label">Name</span>
                  <span class="skill-meta-value">{{ skillMeta.name }}</span>
                </div>
                <div v-if="skillMeta.description" class="skill-meta-row">
                  <span class="skill-meta-label">Description</span>
                  <span class="skill-meta-value">{{ skillMeta.description }}</span>
                </div>
                <div v-if="skillMeta.trigger" class="skill-meta-row">
                  <span class="skill-meta-label">Trigger</span>
                  <span class="skill-meta-value">{{ skillMeta.trigger }}</span>
                </div>
              </div>

              <div class="file-editor-body">
                <n-input
                  v-if="fileViewMode === 'raw'"
                  v-model:value="selectedFileContent"
                  type="textarea"
                  :autosize="false"
                  style="height: 100%; font-family: monospace; font-size: 13px;"
                />
                <div
                  v-else
                  class="markdown-preview"
                  v-html="renderMarkdown(selectedFilePath === 'SKILL.md' ? skillBody : selectedFileContent)"
                />
              </div>
            </template>
            <div v-else class="file-editor-empty">
              {{ selectedSkill ? '從左側選擇一個檔案來編輯。' : '從左側選擇一個 Skill 來查看。' }}
            </div>
          </div>
        </div>

        <!-- Create Skill Modal -->
        <n-modal v-model:show="createModalVisible" preset="card" title="建立新 Skill" style="max-width: 520px; margin-top: 10vh;">
          <n-form :model="createForm" label-placement="top">
            <n-form-item label="Skill 名稱" required>
              <n-input v-model:value="createForm.name" placeholder="my-skill" />
            </n-form-item>
            <n-form-item label="說明 (Description)">
              <n-input v-model:value="createForm.description" placeholder="簡述這個 Skill 的用途" />
            </n-form-item>
            <n-form-item label="觸發條件 (Trigger)">
              <n-input v-model:value="createForm.trigger" placeholder="e.g. /skill-name" />
            </n-form-item>
            <n-form-item label="Instructions">
              <n-input v-model:value="createForm.instructions" type="textarea" :rows="6" placeholder="說明 Skill 的操作方式和步驟..." />
            </n-form-item>
          </n-form>
          <template #footer>
            <n-space justify="end">
              <n-button @click="createModalVisible = false">取消</n-button>
              <n-button type="primary" :loading="creatingSkill" @click="confirmCreateSkill">建立</n-button>
            </n-space>
          </template>
        </n-modal>

        <!-- Upload Skill Modal -->
        <n-modal v-model:show="uploadModalVisible" preset="card" title="Upload Skill" style="max-width: 480px; margin-top: 10vh;">
          <div
            class="upload-drop-area"
            :class="{ 'drag-over': uploadDragOver }"
            @click="fileInputRef?.click()"
            @dragover.prevent="uploadDragOver = true"
            @dragleave="uploadDragOver = false"
            @drop.prevent="handleUploadDrop"
          >
            <input ref="fileInputRef" type="file" accept=".md" style="display:none" @change="handleUploadFileChange" />
            <div style="text-align: center; padding: 28px 16px;">
              <div style="font-size: 28px; margin-bottom: 8px;">📤</div>
              <div v-if="uploadFile" style="font-weight: 500;">{{ uploadFile.name }}</div>
              <div v-else style="color: #888; font-size: 13px;">Drag and drop or click to upload</div>
            </div>
          </div>
          <div style="margin-top: 14px;">
            <div style="font-size: 12px; color: #777; margin-bottom: 6px;">Skill 名稱（自動從檔名偵測，可修改）</div>
            <n-input v-model:value="uploadSkillName" placeholder="skill-name" style="font-family: monospace;" />
          </div>
          <div style="margin-top: 10px; font-size: 12px; color: #777;">
            <b>File requirements</b>
            <ul style="margin: 4px 0 0; padding-left: 18px;">
              <li>.md file must contain skill name and description formatted in YAML frontmatter</li>
            </ul>
          </div>
          <template #footer>
            <n-space justify="end">
              <n-button @click="uploadModalVisible = false">Cancel</n-button>
              <n-button type="primary" :loading="uploadingSkill" :disabled="!uploadFile || !uploadSkillName.trim()" @click="confirmUpload">Upload</n-button>
            </n-space>
          </template>
        </n-modal>

        <!-- Rename Skill Modal -->
        <n-modal v-model:show="renameModalVisible" preset="card" title="重新命名 Skill" style="max-width: 400px; margin-top: 15vh;">
          <n-form label-placement="top">
            <n-form-item label="新名稱" required>
              <n-input v-model:value="renameNewName" placeholder="new-skill-name" style="font-family: monospace;" @keyup.enter="doRenameSkill" />
            </n-form-item>
          </n-form>
          <template #footer>
            <n-space justify="end">
              <n-button @click="renameModalVisible = false">取消</n-button>
              <n-button type="primary" :loading="renamingSkill" :disabled="!renameNewName.trim()" @click="doRenameSkill">確認</n-button>
            </n-space>
          </template>
        </n-modal>
      </n-tab-pane>

      <!-- ── Variables ── -->
      <n-tab-pane name="variables" tab="Variables">
        <n-space justify="space-between" align="center" style="margin-bottom: 12px;">
          <n-text depth="3" style="font-size: 12px;">Agent &#x57F7;&#x884C;&#x6642;&#x53EF;&#x8B80;&#x53D6;&#x7684; Key-Value &#x8B8A;&#x6578;&#xFF08;&#x5B58;&#x65BC; DB&#xFF09;</n-text>
          <n-button size="small" type="primary" @click="addVarRow">+ &#x65B0;&#x589E;&#x8B8A;&#x6578;</n-button>
        </n-space>
        <n-list bordered style="margin-bottom: 12px;">
          <n-list-item v-for="(row, idx) in varRows" :key="idx">
            <n-space align="center" style="width: 100%; gap: 8px;">
              <n-input
                v-model:value="row.key"
                placeholder="KEY"
                style="width: 180px; font-family: monospace;"
                @update:value="debounceSaveVars"
              />
              <n-text depth="3">=</n-text>
              <n-input
                v-model:value="row.value"
                placeholder="value"
                style="flex: 1; font-family: monospace;"
                @update:value="debounceSaveVars"
              />
              <n-button size="tiny" type="error" ghost @click="removeVarRow(idx)">&#x79FB;&#x9664;</n-button>
            </n-space>
          </n-list-item>
          <n-empty v-if="varRows.length === 0" description="&#x5C1A;&#x7121;&#x8B8A;&#x6578;" style="padding: 24px;" />
        </n-list>
        <n-space justify="end">
          <n-tag v-if="varsSaved" type="success" size="small" :bordered="false">&#x5DF2;&#x5132;&#x5B58;</n-tag>
          <n-tag v-else-if="varsSaving" type="warning" size="small" :bordered="false">&#x5132;&#x5B58;&#x4E2D;...</n-tag>
        </n-space>
      </n-tab-pane>

      <!-- ── MCP ── -->
      <n-tab-pane name="mcp" tab="MCP">
        <n-space justify="space-between" align="center" style="margin-bottom: 12px;">
          <n-text depth="3" style="font-size: 12px;">每個 Agent 各自的 MCP Server 設定（讀寫 .mcp.json）</n-text>
          <n-button size="small" type="primary" @click="openMcpAddModal">+ 新增 Server</n-button>
        </n-space>
        <n-list bordered style="margin-bottom: 12px;">
          <n-list-item v-for="(entry, key) in mcpServers" :key="key">
            <n-space align="center" style="width: 100%; gap: 8px;">
              <div style="flex: 1; min-width: 0;">
                <n-text strong>{{ key }}</n-text>
                <n-text depth="3" style="font-size: 12px; display: block; font-family: monospace; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                  {{ entry.command }} {{ (entry.args || []).join(' ') }}
                </n-text>
                <n-text v-if="entry.description" depth="3" style="font-size: 11px; display: block;">{{ entry.description }}</n-text>
              </div>
              <n-space>
                <n-button size="tiny" ghost @click="openMcpEditModal(key, entry)">編輯</n-button>
                <n-popconfirm @positive-click="deleteMcpServer(key)">
                  <template #trigger>
                    <n-button size="tiny" type="error" ghost>移除</n-button>
                  </template>
                  確定移除 {{ key }}？
                </n-popconfirm>
              </n-space>
            </n-space>
          </n-list-item>
          <n-empty v-if="Object.keys(mcpServers).length === 0" description="尚無 MCP Server" style="padding: 24px;" />
        </n-list>

        <!-- MCP Add/Edit Modal -->
        <n-modal v-model:show="mcpModalVisible" preset="card" :title="mcpEditKey ? `編輯 ${mcpEditKey}` : '新增 MCP Server'" style="width: 560px;">
          <n-form label-placement="left" label-width="90" style="margin-bottom: 8px;">
            <n-form-item label="Server Name" required>
              <n-input v-model:value="mcpForm.name" :disabled="!!mcpEditKey" placeholder="e.g. slack" style="font-family: monospace;" />
            </n-form-item>
            <n-form-item label="Command" required>
              <n-input v-model:value="mcpForm.command" placeholder="e.g. node, bun, python" style="font-family: monospace;" />
            </n-form-item>
            <n-form-item label="Args">
              <n-input v-model:value="mcpForm.argsRaw" type="textarea" :autosize="{ minRows: 2 }" placeholder="每行一個 arg，e.g.&#10;/path/to/server.js&#10;--port&#10;3000" style="font-family: monospace;" />
            </n-form-item>
            <n-form-item label="Description">
              <n-input v-model:value="mcpForm.description" placeholder="選填說明" />
            </n-form-item>
            <n-form-item label="Env Vars">
              <div style="width: 100%;">
                <n-space v-for="(row, idx) in mcpForm.envRows" :key="idx" align="center" style="margin-bottom: 6px;">
                  <n-input v-model:value="row.key" placeholder="KEY" style="width: 140px; font-family: monospace;" />
                  <n-text depth="3">=</n-text>
                  <n-input v-model:value="row.value" placeholder="value" style="width: 200px; font-family: monospace;" />
                  <n-button size="tiny" ghost @click="mcpForm.envRows.splice(idx, 1)">✕</n-button>
                </n-space>
                <n-button size="tiny" ghost @click="mcpForm.envRows.push({ key: '', value: '' })">+ Env</n-button>
              </div>
            </n-form-item>
          </n-form>
          <n-space justify="end">
            <n-button @click="mcpModalVisible = false">取消</n-button>
            <n-button type="primary" :loading="mcpSaving" @click="saveMcpServer">儲存</n-button>
          </n-space>
        </n-modal>
      </n-tab-pane>

      <!-- ── Repos ── -->
      <n-tab-pane name="repos" tab="Repos">
        <n-space justify="space-between" align="center" style="margin-bottom: 12px;">
          <n-text depth="3" style="font-size: 12px;">Agent 專屬 Git Repo（Clone 到 agents/{name}/repos/）</n-text>
          <n-button size="small" type="primary" @click="openCloneModal">+ Clone Repo</n-button>
        </n-space>
        <n-list bordered style="margin-bottom: 12px;">
          <n-list-item v-for="repo in repos" :key="repo.name">
            <n-space align="center" style="width: 100%;">
              <div style="flex: 1; min-width: 0;">
                <n-text strong>{{ repo.name }}</n-text>
                <n-text depth="3" style="font-size: 12px; display: block; font-family: monospace; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                  {{ repo.path }}
                </n-text>
                <n-text v-if="repo.description" depth="3" style="font-size: 11px; display: block;">{{ repo.description }}</n-text>
              </div>
              <n-popconfirm @positive-click="doDeleteRepo(repo.name)">
                <template #trigger>
                  <n-button size="tiny" type="error" ghost>移除</n-button>
                </template>
                確定移除 {{ repo.name }}？此操作將刪除本地目錄。
              </n-popconfirm>
            </n-space>
          </n-list-item>
          <n-empty v-if="repos.length === 0" description="尚無 Repo" style="padding: 24px;" />
        </n-list>

        <!-- Clone Repo Modal -->
        <n-modal v-model:show="cloneModalVisible" preset="card" title="Clone Git Repo" style="width: 480px;">
          <n-form label-placement="left" label-width="80" style="margin-bottom: 8px;">
            <n-form-item label="Git URL" required>
              <n-input v-model:value="cloneForm.url" placeholder="https://github.com/org/repo.git" style="font-family: monospace;" />
            </n-form-item>
            <n-form-item label="Name">
              <n-input v-model:value="cloneForm.name" placeholder="選填，預設從 URL 推導" style="font-family: monospace;" />
            </n-form-item>
            <n-form-item label="Description">
              <n-input v-model:value="cloneForm.description" placeholder="選填說明" />
            </n-form-item>
          </n-form>
          <n-space justify="end">
            <n-button @click="cloneModalVisible = false">取消</n-button>
            <n-button type="primary" :loading="cloning" @click="doCloneRepo">Clone</n-button>
          </n-space>
        </n-modal>
      </n-tab-pane>
    </n-tabs>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, nextTick, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { marked } from 'marked'
import {
  NSpace, NButton, NButtonGroup, NTabs, NTabPane, NH3, NTag, NBadge,
  NDescriptions, NDescriptionsItem, NInput, NEmpty, NPopconfirm,
  NText, NCard, NForm, NFormItem, NSelect, NList, NListItem,
  NDropdown, NModal,
} from 'naive-ui'
import { useAgentsStore } from '@/stores/agents'
import {
  getAgent, updateAgent, deleteAgent,
  listDocs, getDoc, putDoc, deleteDoc as apiDeleteDoc,
  listSkills, putSkill, deleteSkill as apiDeleteSkill, renameSkill as apiRenameSkill,
  listSkillFiles, getSkillFile, putSkillFile, deleteSkillFile,
  getClaudeMd, putClaudeMd, getVariables, putVariables,
  getMcpConfig, putMcpConfig,
  listRepos, cloneRepo, deleteRepo,
  type SkillFileEntry, type McpServerEntry, type McpConfig, type Repo,
} from '@/api/agents'
import { API_BASE_URL } from '@/api/config'

const route = useRoute()
const router = useRouter()
const agentsStore = useAgentsStore()

const agentId = route.params.id as string
const agent = ref<Awaited<ReturnType<typeof getAgent>> | null>(null)
const activeTab = ref('overview')

// ── Start / Stop ──────────────────────────────────────────────────────────
const actionLoading = ref(false)
async function handleStart() {
  actionLoading.value = true
  try { await agentsStore.start(agentId) } finally { actionLoading.value = false }
  agent.value = await getAgent(agentId)
}
async function handleStop() {
  actionLoading.value = true
  try { await agentsStore.stop(agentId) } finally { actionLoading.value = false }
  agent.value = await getAgent(agentId)
}

// ── Edit Agent settings ───────────────────────────────────────────────────
const editForm = reactive({ name: '', description: '' })
const editSaving = ref(false)

async function saveAgentEdit() {
  editSaving.value = true
  try {
    const updated = await updateAgent(agentId, {
      name: editForm.name,
      description: editForm.description || undefined,
    })
    agent.value = updated
  } finally { editSaving.value = false }
}

// ── Delete Agent ──────────────────────────────────────────────────────────
async function handleDelete() {
  await deleteAgent(agentId)
  router.push('/agents')
}

// ── CLAUDE.md (auto-save with debounce) ───────────────────────────────────
const claudeMdContent = ref('')
const claudeMdSaving = ref(false)
const claudeMdSaved = ref(false)
let claudeMdTimer: ReturnType<typeof setTimeout> | null = null

function debounceSaveClaudeMd() {
  claudeMdSaved.value = false
  if (claudeMdTimer) clearTimeout(claudeMdTimer)
  claudeMdTimer = setTimeout(async () => {
    claudeMdSaving.value = true
    try {
      await putClaudeMd(agentId, claudeMdContent.value)
      claudeMdSaved.value = true
      setTimeout(() => { claudeMdSaved.value = false }, 2000)
    } finally { claudeMdSaving.value = false }
  }, 600)
}

// ── Markdown render ───────────────────────────────────────────────────────
function renderMarkdown(src: string): string {
  return marked.parse(src) as string
}

// ── Logs SSE stream ───────────────────────────────────────────────────────
const logLines = ref<{ level: string; msg: string; ts: number }[]>([])
const logContainerRef = ref<HTMLElement | null>(null)
let logsEventSource: EventSource | null = null

function startLogsWatch() {
  logLines.value = []
  const token = localStorage.getItem('token')
  if (logsEventSource) { logsEventSource.close(); logsEventSource = null }
  logsEventSource = new EventSource(
    `${API_BASE_URL}/agents/${agentId}/logs/stream?token=${encodeURIComponent(token ?? '')}`
  )
  logsEventSource.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data)
      logLines.value.push({ level: data.level ?? 'info', msg: data.message ?? e.data, ts: data.timestamp ?? Date.now() })
      nextTick(() => {
        if (logContainerRef.value) logContainerRef.value.scrollTop = logContainerRef.value.scrollHeight
      })
    } catch {
      logLines.value.push({ level: 'info', msg: e.data, ts: Date.now() })
    }
  }
  logsEventSource.onerror = () => {
    logLines.value.push({ level: 'error', msg: '[連線中斷]', ts: Date.now() })
  }
}

function stopLogsWatch() {
  logsEventSource?.close()
  logsEventSource = null
}

function formatLogTime(ts: number) {
  return new Date(ts).toLocaleTimeString()
}

// ── Docs (SSE file watch) ─────────────────────────────────────────────────
const docs = ref<string[]>([])
const docPaneOpen = ref(false)
const docCreating = ref(false)
const docFilename = ref('')
const docContent = ref('')
const docViewMode = ref<'raw' | 'preview'>('raw')
const savingDoc = ref(false)
let docsEventSource: EventSource | null = null

function startDocsWatch() {
  const token = localStorage.getItem('token')
  if (docsEventSource) { docsEventSource.close(); docsEventSource = null }
  const url = `${API_BASE_URL}/agents/${agentId}/docs/watch?token=${encodeURIComponent(token ?? '')}`
  docsEventSource = new EventSource(url)
  docsEventSource.onmessage = (e) => {
    try { docs.value = JSON.parse(e.data) } catch { /* ignore */ }
  }
  docsEventSource.onerror = () => {
    docsEventSource?.close()
    docsEventSource = null
    setTimeout(() => { if (activeTab.value === 'docs') startDocsWatch() }, 3000)
  }
}

function stopDocsWatch() {
  docsEventSource?.close()
  docsEventSource = null
}

function openDocCreate() {
  docCreating.value = true
  docFilename.value = ''
}

async function confirmDocCreate() {
  if (!docFilename.value) return
  docCreating.value = false
  docContent.value = ''
  docPaneOpen.value = true
  await saveDoc()
}

async function openDocEdit(filename: string) {
  docFilename.value = filename
  const result = await getDoc(agentId, filename)
  docContent.value = result.content
  docPaneOpen.value = true
}

async function saveDoc() {
  if (!docFilename.value) return
  savingDoc.value = true
  try {
    await putDoc(agentId, docFilename.value, docContent.value)
  } finally { savingDoc.value = false }
}

async function deleteDocAndClose() {
  await apiDeleteDoc(agentId, docFilename.value)
  docPaneOpen.value = false
  docFilename.value = ''
  docContent.value = ''
}

// ── Skills ────────────────────────────────────────────────────────────────
const skills = ref<string[]>([])

// Expansion state
const expandedSkills = ref<Set<string>>(new Set())
const expandedSubDirs = ref<Set<string>>(new Set())

// Per-skill file trees (loaded lazily when expanded)
const skillFileTrees = ref<Map<string, SkillFileEntry[]>>(new Map())

// Selected file
const selectedSkill = ref('')
const selectedFilePath = ref('')
const selectedFileContent = ref('')
const fileViewMode = ref<'raw' | 'preview'>('raw')
const savingFile = ref(false)

// Create modal
const createModalVisible = ref(false)
const createForm = reactive({ name: '', description: '', trigger: '', instructions: '' })
const creatingSkill = ref(false)

// Upload modal
const uploadModalVisible = ref(false)
const uploadFile = ref<File | null>(null)
const uploadingSkill = ref(false)
const uploadDragOver = ref(false)
const fileInputRef = ref<HTMLInputElement | null>(null)

// "+ New" dropdown options
const newSkillMenuOptions = [
  { label: 'Create', key: 'create' },
  { label: 'Upload .md', key: 'upload' },
]

// Skill action options (⋯ menu)
const skillActionOptions = [
  { label: '重新命名', key: 'rename' },
  { label: '刪除 Skill', key: 'delete' },
]

// Rename modal
const renameModalVisible = ref(false)
const renameTargetSkill = ref('')
const renameNewName = ref('')
const renamingSkill = ref(false)

// Parse YAML frontmatter from skill content
function parseFrontmatter(content: string): { meta: Record<string, string>; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  if (!match) return { meta: {}, body: content }
  const meta: Record<string, string> = {}
  match[1].split('\n').forEach(line => {
    const colon = line.indexOf(':')
    if (colon > 0) {
      const k = line.slice(0, colon).trim()
      const v = line.slice(colon + 1).trim()
      if (k) meta[k] = v
    }
  })
  return { meta, body: match[2].trimStart() }
}

const skillMeta = computed(() => parseFrontmatter(selectedFileContent.value).meta)
const skillBody = computed(() => parseFrontmatter(selectedFileContent.value).body)

async function loadSkills() { skills.value = await listSkills(agentId) }

// Flatten skill tree into a flat list for rendering (with depth and visibility)
interface FlatTreeNode {
  name: string
  path: string
  type: 'file' | 'dir'
  depth: number
}

function flattenSkillTree(skill: string): FlatTreeNode[] {
  const tree = skillFileTrees.value.get(skill) ?? []
  const result: FlatTreeNode[] = []
  function walk(nodes: SkillFileEntry[], depth: number, parentExpanded: boolean) {
    if (!parentExpanded) return
    for (const node of nodes) {
      result.push({ name: node.name, path: node.path, type: node.type, depth })
      if (node.type === 'dir' && expandedSubDirs.value.has(skill + '/' + node.path)) {
        walk(node.children ?? [], depth + 1, true)
      }
    }
  }
  walk(tree, 0, true)
  return result
}

async function toggleSkillExpand(skill: string) {
  if (expandedSkills.value.has(skill)) {
    expandedSkills.value.delete(skill)
    expandedSkills.value = new Set(expandedSkills.value)
  } else {
    expandedSkills.value.add(skill)
    expandedSkills.value = new Set(expandedSkills.value)
    // Load file tree if not cached
    if (!skillFileTrees.value.has(skill)) {
      const tree = await listSkillFiles(agentId, skill)
      skillFileTrees.value.set(skill, tree)
      skillFileTrees.value = new Map(skillFileTrees.value)
    }
  }
}

function toggleSubDir(skill: string, dirPath: string) {
  const key = skill + '/' + dirPath
  if (expandedSubDirs.value.has(key)) {
    expandedSubDirs.value.delete(key)
  } else {
    expandedSubDirs.value.add(key)
  }
  expandedSubDirs.value = new Set(expandedSubDirs.value)
}

async function openSkillFile(skill: string, filePath: string) {
  selectedSkill.value = skill
  selectedFilePath.value = filePath
  const result = await getSkillFile(agentId, skill, filePath)
  selectedFileContent.value = result.content
}

async function saveSkillFile() {
  if (!selectedSkill.value || !selectedFilePath.value) return
  savingFile.value = true
  try {
    await putSkillFile(agentId, selectedSkill.value, selectedFilePath.value, selectedFileContent.value)
  } finally {
    savingFile.value = false
  }
}

async function doDeleteSkillFile() {
  if (!selectedSkill.value || !selectedFilePath.value) return
  await deleteSkillFile(agentId, selectedSkill.value, selectedFilePath.value)
  // Reload tree
  const tree = await listSkillFiles(agentId, selectedSkill.value)
  skillFileTrees.value.set(selectedSkill.value, tree)
  skillFileTrees.value = new Map(skillFileTrees.value)
  selectedFilePath.value = ''
  selectedFileContent.value = ''
}

function handleNewSkillMenu(key: string) {
  if (key === 'create') {
    createForm.name = ''
    createForm.description = ''
    createForm.trigger = ''
    createForm.instructions = ''
    createModalVisible.value = true
  } else if (key === 'upload') {
    uploadFile.value = null
    uploadSkillName.value = ''
    uploadModalVisible.value = true
  }
}

async function confirmCreateSkill() {
  if (!createForm.name.trim()) return
  creatingSkill.value = true
  try {
    const slug = createForm.name.trim()
    const frontmatter = [
      '---',
      `name: ${slug}`,
      createForm.description ? `description: ${createForm.description}` : '',
      createForm.trigger ? `trigger: ${createForm.trigger}` : '',
      '---',
    ].filter(Boolean).join('\n')
    const instructions = createForm.instructions.trim()
      ? `\n\n## Instructions\n\n${createForm.instructions.trim()}`
      : ''
    const content = `${frontmatter}\n\n# ${slug}${instructions}\n`
    await putSkill(agentId, slug, content)
    await loadSkills()
    // Expand the new skill and open SKILL.md
    expandedSkills.value.add(slug)
    expandedSkills.value = new Set(expandedSkills.value)
    const tree = await listSkillFiles(agentId, slug)
    skillFileTrees.value.set(slug, tree)
    skillFileTrees.value = new Map(skillFileTrees.value)
    await openSkillFile(slug, 'SKILL.md')
    createModalVisible.value = false
  } finally {
    creatingSkill.value = false
  }
}

async function doRenameSkill() {
  const oldName = renameTargetSkill.value
  const newName = renameNewName.value.trim()
  if (!newName || newName === oldName) { renameModalVisible.value = false; return }
  renamingSkill.value = true
  try {
    await apiRenameSkill(agentId, oldName, newName)
    await loadSkills()
    // Update expanded/tree caches
    if (expandedSkills.value.has(oldName)) {
      expandedSkills.value.delete(oldName)
      expandedSkills.value.add(newName)
      expandedSkills.value = new Set(expandedSkills.value)
    }
    if (skillFileTrees.value.has(oldName)) {
      const tree = skillFileTrees.value.get(oldName)!
      skillFileTrees.value.delete(oldName)
      skillFileTrees.value.set(newName, tree)
      skillFileTrees.value = new Map(skillFileTrees.value)
    }
    if (selectedSkill.value === oldName) {
      selectedSkill.value = newName
    }
    renameModalVisible.value = false
  } finally {
    renamingSkill.value = false
  }
}

async function handleSkillAction(key: string, skill: string) {
  if (key === 'rename') {
    renameTargetSkill.value = skill
    renameNewName.value = skill
    renameModalVisible.value = true
  } else if (key === 'delete') {
    await apiDeleteSkill(agentId, skill)
    await loadSkills()
    skillFileTrees.value.delete(skill)
    skillFileTrees.value = new Map(skillFileTrees.value)
    expandedSkills.value.delete(skill)
    expandedSkills.value = new Set(expandedSkills.value)
    if (selectedSkill.value === skill) {
      selectedSkill.value = ''
      selectedFilePath.value = ''
      selectedFileContent.value = ''
    }
  }
}

const uploadSkillName = ref('')

function handleUploadFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0] ?? null
  uploadFile.value = file
  if (file) uploadSkillName.value = file.name.replace(/\.md$/i, '').replace(/\s+/g, '-')
}

function handleUploadDrop(e: DragEvent) {
  uploadDragOver.value = false
  const file = e.dataTransfer?.files?.[0]
  if (file && file.name.endsWith('.md')) {
    uploadFile.value = file
    uploadSkillName.value = file.name.replace(/\.md$/i, '').replace(/\s+/g, '-')
  }
}

async function confirmUpload() {
  if (!uploadFile.value) return
  uploadingSkill.value = true
  try {
    const text = await uploadFile.value.text()
    const slug = uploadSkillName.value.trim() || uploadFile.value.name.replace(/\.md$/i, '').replace(/\s+/g, '-')
    await putSkill(agentId, slug, text)
    await loadSkills()
    expandedSkills.value.add(slug)
    expandedSkills.value = new Set(expandedSkills.value)
    const tree = await listSkillFiles(agentId, slug)
    skillFileTrees.value.set(slug, tree)
    skillFileTrees.value = new Map(skillFileTrees.value)
    await openSkillFile(slug, 'SKILL.md')
    uploadModalVisible.value = false
  } finally {
    uploadingSkill.value = false
  }
}

// ── Variables (auto-save with debounce) ───────────────────────────────────
interface VarRow { key: string; value: string }
const varRows = reactive<VarRow[]>([])
const varsSaving = ref(false)
const varsSaved = ref(false)
let varsTimer: ReturnType<typeof setTimeout> | null = null

function addVarRow() { varRows.push({ key: '', value: '' }) }
function removeVarRow(idx: number) {
  varRows.splice(idx, 1)
  debounceSaveVars()
}

function debounceSaveVars() {
  varsSaved.value = false
  if (varsTimer) clearTimeout(varsTimer)
  varsTimer = setTimeout(async () => {
    varsSaving.value = true
    try {
      const obj = Object.fromEntries(
        varRows.filter(r => r.key.trim()).map(r => [r.key.trim(), r.value])
      )
      await putVariables(agentId, obj)
      varsSaved.value = true
      setTimeout(() => { varsSaved.value = false }, 2000)
    } finally { varsSaving.value = false }
  }, 600)
}

// ── MCP ───────────────────────────────────────────────────────────────────
const mcpServers = ref<Record<string, McpServerEntry>>({})
const mcpModalVisible = ref(false)
const mcpEditKey = ref('')
const mcpSaving = ref(false)
const mcpForm = reactive({
  name: '',
  command: '',
  argsRaw: '',
  description: '',
  envRows: [] as { key: string; value: string }[],
})

async function loadMcp() {
  const cfg = await getMcpConfig(agentId).catch(() => ({ mcpServers: {} } as McpConfig))
  mcpServers.value = cfg.mcpServers ?? {}
}

function openMcpAddModal() {
  mcpEditKey.value = ''
  mcpForm.name = ''
  mcpForm.command = ''
  mcpForm.argsRaw = ''
  mcpForm.description = ''
  mcpForm.envRows = []
  mcpModalVisible.value = true
}

function openMcpEditModal(key: string, entry: McpServerEntry) {
  mcpEditKey.value = key
  mcpForm.name = key
  mcpForm.command = entry.command
  mcpForm.argsRaw = (entry.args || []).join('\n')
  mcpForm.description = entry.description || ''
  mcpForm.envRows = Object.entries(entry.env || {}).map(([k, v]) => ({ key: k, value: v }))
  mcpModalVisible.value = true
}

async function saveMcpServer() {
  const name = mcpEditKey.value || mcpForm.name.trim()
  if (!name || !mcpForm.command.trim()) return
  const args = mcpForm.argsRaw.split('\n').map(s => s.trim()).filter(Boolean)
  const env: Record<string, string> = {}
  for (const row of mcpForm.envRows) {
    if (row.key.trim()) env[row.key.trim()] = row.value
  }
  const entry: McpServerEntry = {
    command: mcpForm.command.trim(),
    ...(args.length ? { args } : {}),
    ...(Object.keys(env).length ? { env } : {}),
    ...(mcpForm.description.trim() ? { description: mcpForm.description.trim() } : {}),
  }
  mcpSaving.value = true
  try {
    const updated = { ...mcpServers.value, [name]: entry }
    await putMcpConfig(agentId, { mcpServers: updated })
    mcpServers.value = updated
    mcpModalVisible.value = false
  } finally {
    mcpSaving.value = false
  }
}

async function deleteMcpServer(key: string) {
  const updated = { ...mcpServers.value }
  delete updated[key]
  await putMcpConfig(agentId, { mcpServers: updated })
  mcpServers.value = updated
}

// ── Repos ─────────────────────────────────────────────────────────────────
const repos = ref<Repo[]>([])
const cloneModalVisible = ref(false)
const cloning = ref(false)
const cloneForm = reactive({ url: '', name: '', description: '' })

async function loadRepos() {
  repos.value = await listRepos(agentId).catch(() => [])
}

function openCloneModal() {
  cloneForm.url = ''
  cloneForm.name = ''
  cloneForm.description = ''
  cloneModalVisible.value = true
}

async function doCloneRepo() {
  if (!cloneForm.url.trim()) return
  cloning.value = true
  try {
    const r = await cloneRepo(agentId, cloneForm.url.trim(), cloneForm.name.trim() || undefined, cloneForm.description.trim())
    repos.value = [...repos.value, r]
    cloneModalVisible.value = false
  } finally {
    cloning.value = false
  }
}

async function doDeleteRepo(name: string) {
  await deleteRepo(agentId, name)
  repos.value = repos.value.filter(r => r.name !== name)
}

// ── Tab change: start/stop SSE watchers ──────────────────────────────────
function onTabChange(tab: string) {
  if (tab === 'docs') {
    startDocsWatch()
    stopLogsWatch()
  } else if (tab === 'logs') {
    startLogsWatch()
    stopDocsWatch()
  } else {
    stopDocsWatch()
    stopLogsWatch()
  }
}

// ── Init ──────────────────────────────────────────────────────────────────
onMounted(async () => {
  const [a, claudeMd, variables] = await Promise.all([
    getAgent(agentId),
    getClaudeMd(agentId).catch(() => ({ content: '' })),
    getVariables(agentId).catch(() => ({} as Record<string, string>)),
  ])
  agent.value = a
  claudeMdContent.value = claudeMd.content

  // Populate edit form
  editForm.name = a.name
  editForm.description = a.description ?? ''

  await Promise.all([loadSkills(), loadMcp(), loadRepos()])

  for (const [k, v] of Object.entries(variables)) {
    varRows.push({ key: k, value: String(v) })
  }
})

onUnmounted(() => {
  stopDocsWatch()
  stopLogsWatch()
  if (claudeMdTimer) clearTimeout(claudeMdTimer)
  if (varsTimer) clearTimeout(varsTimer)
})
</script>

<style scoped>
/* ── Split-pane layout ─────────────────────────────────────── */
.file-editor-layout {
  display: flex;
  height: calc(100vh - 220px);
  min-height: 480px;
  border: 1px solid var(--n-border-color, #e0e0e6);
  border-radius: 6px;
  overflow: hidden;
}

/* ── Left: file list ───────────────────────────────────────── */
.file-list-panel {
  width: 220px;
  flex-shrink: 0;
  border-right: 1px solid var(--n-border-color, #e0e0e6);
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  background: var(--n-color, #fff);
}

.file-list-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px 8px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.05em;
  color: var(--n-text-color-3, #aaa);
  border-bottom: 1px solid var(--n-border-color, #e0e0e6);
  flex-shrink: 0;
}

.file-list-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 12px;
  cursor: pointer;
  font-size: 13px;
  border-radius: 0;
  transition: background 0.15s;
  user-select: none;
}

.file-list-item:hover {
  background: var(--n-color-hover, rgba(99, 226, 183, 0.1));
}

.file-list-item.active {
  background: var(--n-color-hover, rgba(99, 226, 183, 0.15));
  font-weight: 500;
}

.file-icon { font-size: 12px; flex-shrink: 0; }
.file-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.file-list-empty {
  padding: 16px 12px;
  font-size: 12px;
  color: var(--n-text-color-3, #aaa);
}

.file-new-input {
  padding: 6px 8px;
  border-top: 1px solid var(--n-border-color, #e0e0e6);
}

/* ── Right: editor ─────────────────────────────────────────── */
.file-editor-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--n-color, #fff);
}

.file-editor-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 14px;
  border-bottom: 1px solid var(--n-border-color, #e0e0e6);
  flex-shrink: 0;
  gap: 8px;
}

.file-editor-filename {
  font-size: 13px;
  font-weight: 500;
  font-family: monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-editor-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.file-editor-body {
  flex: 1;
  overflow: auto;
  display: flex;
  flex-direction: column;
}

.file-editor-body :deep(textarea) {
  flex: 1;
  height: 100% !important;
  border: none !important;
  border-radius: 0 !important;
  resize: none;
}

.file-editor-body :deep(.n-input) {
  flex: 1;
  border: none !important;
  border-radius: 0 !important;
  box-shadow: none !important;
}

.file-editor-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  color: var(--n-text-color-3, #aaa);
}

/* ── Markdown preview ──────────────────────────────────────── */
.markdown-preview {
  flex: 1;
  padding: 20px 28px;
  overflow-y: auto;
  font-size: 14px;
  line-height: 1.7;
}

.markdown-preview :deep(h1) { font-size: 1.6em; font-weight: 700; margin: 0 0 16px; }
.markdown-preview :deep(h2) { font-size: 1.3em; font-weight: 600; margin: 24px 0 12px; }
.markdown-preview :deep(h3) { font-size: 1.1em; font-weight: 600; margin: 18px 0 8px; }
.markdown-preview :deep(p)  { margin: 0 0 12px; }
.markdown-preview :deep(ul),
.markdown-preview :deep(ol) { padding-left: 20px; margin: 0 0 12px; }
.markdown-preview :deep(li) { margin-bottom: 4px; }
.markdown-preview :deep(code) {
  font-family: monospace;
  font-size: 12px;
  background: var(--n-color-hover, rgba(0,0,0,0.05));
  padding: 1px 5px;
  border-radius: 3px;
}
.markdown-preview :deep(pre) {
  background: var(--n-color-hover, rgba(0,0,0,0.05));
  padding: 12px 16px;
  border-radius: 6px;
  overflow-x: auto;
  margin: 0 0 12px;
}
.markdown-preview :deep(pre code) { background: none; padding: 0; }
.markdown-preview :deep(blockquote) {
  border-left: 3px solid var(--n-border-color, #ddd);
  margin: 0 0 12px;
  padding: 4px 12px;
  color: var(--n-text-color-3, #888);
}
.markdown-preview :deep(a) { color: var(--n-primary-color, #18a058); }
.markdown-preview :deep(hr) { border: none; border-top: 1px solid var(--n-border-color, #eee); margin: 16px 0; }
.markdown-preview :deep(table) { border-collapse: collapse; width: 100%; margin-bottom: 12px; }
.markdown-preview :deep(th),
.markdown-preview :deep(td) { border: 1px solid var(--n-border-color, #ddd); padding: 6px 12px; font-size: 13px; }
.markdown-preview :deep(th) { background: var(--n-color-hover, rgba(0,0,0,0.04)); font-weight: 600; }

/* ── Log stream ────────────────────────────────────────────── */
.log-stream-container {
  font-family: monospace;
  font-size: 12px;
  height: calc(100vh - 260px);
  min-height: 360px;
  overflow-y: auto;
  background: #1a1a2e;
  padding: 14px 16px;
  border-radius: 6px;
  line-height: 1.6;
}

/* ── Skill tree rows ───────────────────────────────────────── */
.skill-root-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 12px;
  cursor: pointer;
  font-size: 13px;
  user-select: none;
}
.skill-root-row:hover,
.skill-root-row.active {
  background: var(--n-color-hover, rgba(99, 226, 183, 0.08));
}
.tree-caret {
  font-size: 10px;
  color: #888;
  width: 10px;
  flex-shrink: 0;
}
.skill-icon {
  font-size: 14px;
  flex-shrink: 0;
}
.skill-root-name {
  flex: 1;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.skill-more-btn {
  opacity: 0.4;
}
.skill-more-btn:hover {
  opacity: 1;
}
.skill-tree-node {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 5px 12px;
  cursor: pointer;
  font-size: 12px;
  user-select: none;
}
.skill-tree-node:hover,
.skill-tree-node.active {
  background: var(--n-color-hover, rgba(99, 226, 183, 0.08));
}
.skill-tree-node.is-dir {
  color: #888;
}
.node-icon {
  flex-shrink: 0;
  font-size: 11px;
}
.node-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ── Upload drop area ──────────────────────────────────────── */
.upload-drop-area {
  border: 2px dashed #444;
  border-radius: 8px;
  cursor: pointer;
  transition: border-color 0.15s;
}
.upload-drop-area:hover,
.upload-drop-area.drag-over {
  border-color: #63e2b7;
}

/* ── Skill metadata panel ──────────────────────────────────── */
.skill-meta-panel {
  padding: 10px 16px;
  background: var(--n-color-hover, rgba(99, 226, 183, 0.06));
  border-bottom: 1px solid var(--n-border-color, #e0e0e6);
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex-shrink: 0;
}

.skill-meta-row {
  display: flex;
  align-items: baseline;
  gap: 12px;
  font-size: 12px;
}

.skill-meta-label {
  color: var(--n-text-color-3, #aaa);
  font-weight: 600;
  min-width: 80px;
  flex-shrink: 0;
}

.skill-meta-value {
  color: var(--n-text-color-1, #333);
}
</style>
