import axios from 'axios'

const api = axios.create({
  baseURL: '/api',
  timeout: 15000,
})

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('token')
      window.location.href = '/login'
    }
    return Promise.reject(err)
  }
)

export default api

// ── Auth ──
export const authApi = {
  login: (email: string, password: string) =>
    api.post('/auth/login', { email, password }),
  register: (email: string, password: string) =>
    api.post('/auth/register', { email, password }),
  me: () => api.get('/auth/me'),
}

// ── Agents ──
export const agentsApi = {
  list: () => api.get('/agents'),
  get: (id: string) => api.get(`/agents/${id}`),
  create: (data: Record<string, unknown>) => api.post('/agents', data),
  update: (id: string, data: Record<string, unknown>) => api.patch(`/agents/${id}`, data),
  delete: (id: string) => api.delete(`/agents/${id}`),
  start: (id: string) => api.post(`/agents/${id}/start`),
  stop: (id: string) => api.post(`/agents/${id}/stop`),
  integration: (id: string) => api.get(`/agents/${id}/integration`),
}

// ── Queues ──
export const queuesApi = {
  list: () => api.get('/queues'),
  get: (id: string) => api.get(`/queues/${id}`),
  create: (data: { name: string; description?: string }) => api.post('/queues', data),
  update: (id: string, data: Record<string, unknown>) => api.patch(`/queues/${id}`, data),
  delete: (id: string) => api.delete(`/queues/${id}`),
}

// ── Brokers ──
export const brokersApi = {
  list: () => api.get('/brokers'),
  get: (id: string) => api.get(`/brokers/${id}`),
  create: (data: Record<string, unknown>) => api.post('/brokers', data),
  update: (id: string, data: Record<string, unknown>) => api.patch(`/brokers/${id}`, data),
  delete: (id: string) => api.delete(`/brokers/${id}`),
  activate: (id: string) => api.post(`/brokers/${id}/activate`),
  deactivate: (id: string) => api.post(`/brokers/${id}/deactivate`),
}

// ── Routing ──
export const routingApi = {
  list: () => api.get('/routing'),
  create: (data: Record<string, unknown>) => api.post('/routing', data),
  delete: (id: string) => api.delete(`/routing/${id}`),
}

// ── Logs ──
export const logsApi = {
  webhooks: (params?: Record<string, unknown>) => api.get('/logs/webhooks', { params }),
  agents: (params?: Record<string, unknown>) => api.get('/logs', { params }),
  webhookEvents: (params?: Record<string, unknown>) => api.get('/logs/webhooks', { params }),
  agentLogs: (params?: Record<string, unknown>) => api.get('/logs', { params }),
}

// ── Admin ──
export const adminApi = {
  users: () => api.get('/admin/users'),
  stats: () => api.get('/admin/stats'),
  setRole: (id: string, role: string) => api.patch(`/admin/users/${id}`, { role }),
  deleteUser: (id: string) => api.delete(`/admin/users/${id}`),
}

// ── Playground ──
// Returns a ReadableStream reader for SSE chunks from a POST endpoint
export function playgroundStream(agentId: string, message: string) {
  const token = localStorage.getItem('token')
  return fetch('/api/playground/run', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token ?? ''}`,
    },
    body: JSON.stringify({ agentId, message }),
  })
}
