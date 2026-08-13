<template>
  <div class="api-config">
    <el-collapse v-model="activeCollapse" class="model-collapse">
      <el-collapse-item name="models">
        <template #title>
          <div class="collapse-header">
            <div class="header-left">
              <el-icon class="header-icon"><Setting /></el-icon>
              <span class="header-title">AI模型配置</span>
            </div>
            <div class="header-right" @click.stop>
              <div v-if="currentModel" class="current-model">
                <el-tag type="primary" size="small">{{ currentModel.name }}</el-tag>
                <span class="model-provider">{{ currentProvider?.name }}</span>
              </div>
              <el-tag v-else type="warning" size="small">未选择模型</el-tag>
            </div>
          </div>
        </template>

        <div class="config-content">
          <div class="config-actions">
            <el-button type="primary" size="small" @click="showAddCustomDialog">
              <el-icon><Plus /></el-icon>
              添加自定义API
            </el-button>
            <el-button type="success" size="small" @click="saveAllProviders">
              <el-icon><Check /></el-icon>
              保存所有配置
            </el-button>
          </div>

          <div class="providers-grid">
            <div 
              v-for="provider in aiProviderStore.allProviders" 
              :key="provider.id"
              class="provider-card"
              :class="{ 
                active: aiProviderStore.selectedProviderId === provider.id,
                disabled: !provider.enabled,
                custom: provider.isCustom 
              }"
            >
              <div class="provider-header">
                <div class="provider-info">
                  <div class="provider-name">
                    {{ provider.name }}
                    <el-tag v-if="provider.isCustom" size="small" type="info">自定义</el-tag>
                  </div>
                  <div class="provider-status">
                    <el-tag v-if="!provider.apiKey" size="small" type="warning">未配置</el-tag>
                  </div>
                </div>
                <el-switch
                  v-model="provider.enabled"
                  @change="handleProviderEnable(provider)"
                />
              </div>

              <div v-if="provider.enabled" class="provider-body">
                <div class="config-item">
                  <label>API Key</label>
                  <el-input
                    v-model="provider.apiKey"
                    type="password"
                    placeholder="请输入API Key"
                    show-password
                    @blur="handleApiKeyChange(provider)"
                  >
                    <template #prefix>
                      <el-icon><Key /></el-icon>
                    </template>
                  </el-input>
                </div>

                <div v-if="provider.isCustom" class="config-item">
                  <label>API地址</label>
                  <el-input
                    v-model="provider.baseUrl"
                    placeholder="https://api.example.com/v1/chat/completions"
                    @blur="handleApiKeyChange(provider)"
                  >
                    <template #prefix>
                      <el-icon><Link /></el-icon>
                    </template>
                  </el-input>
                </div>

                <div v-if="provider.isCustom" class="config-item">
                  <label>模型名称</label>
                  <el-input
                    v-model="provider.models[0].id"
                    placeholder="模型ID"
                    @blur="handleApiKeyChange(provider)"
                  />
                </div>

                <div v-if="provider.apiKey" class="models-section">
                  <label>选择模型</label>
                  <div class="models-grid">
                    <div
                      v-for="model in provider.models"
                      :key="model.id"
                      class="model-chip"
                      :class="{ selected: aiProviderStore.selectedModelId === model.id }"
                      @click="selectModel(provider.id, model.id)"
                    >
                      {{ model.name }}
                    </div>
                  </div>
                </div>

                <div v-if="provider.isCustom && provider.apiKey" class="advanced-config">
                  <el-collapse>
                    <el-collapse-item title="高级配置" name="advanced">
                      <div class="config-item">
                        <label>自定义请求头 (JSON)</label>
                        <el-input
                          v-model="providerHeadersJson[provider.id]"
                          type="textarea"
                          :rows="3"
                          placeholder='{"Header-Name": "Header-Value"}'
                          @blur="updateProviderHeaders(provider)"
                        />
                      </div>
                      <div class="config-item">
                        <label>请求体模板</label>
                        <el-input
                          v-model="provider.bodyTemplate"
                          type="textarea"
                          :rows="5"
                          placeholder="自定义请求体JSON模板，使用 {prompt}, {maxTokens}, {model} 等占位符"
                          @blur="handleApiKeyChange(provider)"
                        />
                      </div>
                    </el-collapse-item>
                  </el-collapse>
                </div>
              </div>

              <div v-if="provider.isCustom" class="provider-footer">
                <el-button
                  type="danger"
                  size="small"
                  text
                  @click="removeCustomProvider(provider.id)"
                >
                  <el-icon><Delete /></el-icon>
                  删除
                </el-button>
              </div>
            </div>
          </div>
        </div>
      </el-collapse-item>
    </el-collapse>

    <el-dialog
      v-model="addCustomDialogVisible"
      title="添加自定义API"
      width="600px"
      :close-on-click-modal="false"
    >
      <el-form :model="customForm" label-width="120px">
        <el-form-item label="名称" required>
          <el-input v-model="customForm.name" placeholder="例如：我的自定义模型" />
        </el-form-item>
        <el-form-item label="API地址" required>
          <el-input 
            v-model="customForm.baseUrl" 
            placeholder="https://api.example.com/v1/chat/completions" 
          />
        </el-form-item>
        <el-form-item label="API Key">
          <el-input
            v-model="customForm.apiKey"
            type="password"
            placeholder="可选，如果API需要认证"
            show-password
          />
        </el-form-item>
        <el-form-item label="模型ID" required>
          <el-input v-model="customForm.modelId" placeholder="模型标识符" />
        </el-form-item>
        <el-form-item label="模型名称">
          <el-input v-model="customForm.modelName" placeholder="显示名称（可选）" />
        </el-form-item>
        <el-form-item label="最大Token数">
          <el-input-number v-model="customForm.maxTokens" :min="1024" :max="32768" :step="1024" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="addCustomDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="addCustomProvider">添加</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Setting, Plus, Delete, Key, Link, Check } from '@element-plus/icons-vue'
import { useAIProviderStore } from '@/stores/aiProvider'
import type { AIProvider, AIProviderType } from '@/types'

const aiProviderStore = useAIProviderStore()
const activeCollapse = ref<string[]>([])
const addCustomDialogVisible = ref(false)
const providerHeadersJson = ref<Record<string, string>>({})

const customForm = ref({
  name: '',
  baseUrl: '',
  apiKey: '',
  modelId: '',
  modelName: '',
  maxTokens: 8192
})

const currentModel = computed(() => aiProviderStore.selectedModel)
const currentProvider = computed(() => aiProviderStore.selectedProvider)

const providerTypeLabels: Record<AIProviderType, string> = {
  glm: '智谱AI',
  deepseek: 'DeepSeek',
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  xai: 'xAI',
  nalang: 'NLang',
  custom: '自定义'
}

function getProviderTypeLabel(type: AIProviderType): string {
  return providerTypeLabels[type] || type
}

onMounted(() => {
  aiProviderStore.init()
})

function handleProviderEnable(provider: AIProvider) {
  aiProviderStore.updateProvider(provider.id, { enabled: provider.enabled })
  if (provider.enabled && provider.apiKey && provider.models.length > 0) {
    aiProviderStore.setSelectedProvider(provider.id)
    aiProviderStore.setSelectedModel(provider.models[0].id)
  }
}

async function handleApiKeyChange(provider: AIProvider) {
  console.log('handleApiKeyChange 被调用:', provider.id, 'apiKey:', provider.apiKey ? '***' : '(empty)')
  try {
    await aiProviderStore.updateProvider(provider.id, {
      apiKey: provider.apiKey,
      baseUrl: provider.baseUrl,
      models: provider.models,
      bodyTemplate: provider.bodyTemplate
    })
    console.log('updateProvider 完成')
    if (provider.apiKey) {
      ElMessage.success(`${provider.name} API Key 已保存`)
    }
  } catch (error) {
    console.error('保存 API Key 失败:', error)
    ElMessage.error('保存失败，请重试')
  }
}

async function saveAllProviders() {
  console.log('手动保存所有配置')
  try {
    for (const provider of aiProviderStore.allProviders) {
      await aiProviderStore.updateProvider(provider.id, {
        apiKey: provider.apiKey,
        baseUrl: provider.baseUrl,
        enabled: provider.enabled,
        models: provider.models,
        bodyTemplate: provider.bodyTemplate,
        headers: provider.headers
      })
    }
    ElMessage.success('所有配置已保存')
  } catch (error) {
    console.error('保存配置失败:', error)
    ElMessage.error('保存失败，请重试')
  }
}

async function updateProviderHeaders(provider: AIProvider) {
  try {
    const headersJson = providerHeadersJson.value[provider.id]
    if (headersJson) {
      const headers = JSON.parse(headersJson)
      await aiProviderStore.updateProvider(provider.id, { headers })
      ElMessage.success('请求头已更新')
    }
  } catch (e) {
    console.error('Invalid JSON for headers:', e)
    ElMessage.error('JSON 格式错误，请检查')
  }
}

function selectModel(providerId: string, modelId: string) {
  aiProviderStore.setSelectedProvider(providerId)
  aiProviderStore.setSelectedModel(modelId)
  ElMessage.success('已选择模型')
}

function showAddCustomDialog() {
  customForm.value = {
    name: '',
    baseUrl: '',
    apiKey: '',
    modelId: '',
    modelName: '',
    maxTokens: 8192
  }
  addCustomDialogVisible.value = true
}

function addCustomProvider() {
  if (!customForm.value.name || !customForm.value.baseUrl || !customForm.value.modelId) {
    ElMessage.warning('请填写必填项')
    return
  }

  const id = `custom-${Date.now()}`
  const provider: AIProvider = {
    id,
    name: customForm.value.name,
    type: 'custom',
    baseUrl: customForm.value.baseUrl,
    apiKey: customForm.value.apiKey,
    enabled: true,
    isCustom: true,
    models: [
      {
        id: customForm.value.modelId,
        name: customForm.value.modelName || customForm.value.modelId,
        providerId: id,
        maxTokens: customForm.value.maxTokens
      }
    ]
  }

  aiProviderStore.addCustomProvider(provider)
  addCustomDialogVisible.value = false
  ElMessage.success('自定义API已添加')
}

function removeCustomProvider(id: string) {
  ElMessageBox.confirm('确定要删除这个自定义API吗？', '确认删除', {
    confirmButtonText: '删除',
    cancelButtonText: '取消',
    type: 'warning'
  }).then(() => {
    aiProviderStore.removeCustomProvider(id)
    ElMessage.success('已删除')
  }).catch(() => {})
}
</script>

<style scoped>
.api-config {
  padding: 0;
}

.model-collapse {
  border: none;
}

.collapse-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
  padding-right: 10px;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.header-icon {
  font-size: 20px;
  color: var(--primary-color);
}

.header-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
}

.header-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.current-model {
  display: flex;
  align-items: center;
  gap: 8px;
}

.model-provider {
  font-size: 13px;
  color: var(--text-secondary);
}

.config-content {
  padding: 16px 0;
}

.config-actions {
  margin-bottom: 16px;
  display: flex;
  justify-content: flex-end;
}

.providers-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(400px, 1fr));
  gap: 16px;
}

.provider-card {
  background: white;
  border: 2px solid #e5e7eb;
  border-radius: 12px;
  padding: 16px;
  transition: all 0.3s ease;
}

.provider-card.active {
  border-color: var(--primary-color);
  box-shadow: 0 4px 12px rgba(99, 102, 241, 0.15);
}

.provider-card.disabled {
  opacity: 0.6;
}

.provider-card.custom {
  border-style: dashed;
}

.provider-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.provider-info {
  flex: 1;
}

.provider-name {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
  display: flex;
  align-items: center;
  gap: 8px;
}

.provider-status {
  margin-top: 4px;
}

.provider-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.provider-footer {
  margin-top: 16px;
  padding-top: 12px;
  border-top: 1px solid #e5e7eb;
  display: flex;
  justify-content: flex-end;
}

.config-item {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.config-item label {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-secondary);
}

.models-section {
  margin-top: 8px;
}

.models-section label {
  display: block;
  font-size: 13px;
  font-weight: 500;
  color: var(--text-secondary);
  margin-bottom: 8px;
}

.models-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.model-chip {
  padding: 6px 14px;
  background: #f3f4f6;
  border: 2px solid transparent;
  border-radius: 20px;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.model-chip:hover {
  background: #e5e7eb;
}

.model-chip.selected {
  background: var(--primary-color);
  color: white;
  border-color: var(--primary-color);
}

.advanced-config {
  margin-top: 8px;
}

@media (max-width: 768px) {
  .providers-grid {
    grid-template-columns: 1fr;
  }
}
</style>
