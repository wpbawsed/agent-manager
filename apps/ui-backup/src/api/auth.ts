import axios from "axios";
import { API_BASE_URL } from "./config";

const api = axios.create({
  baseURL: API_BASE_URL,
});

// Attach token from localStorage on every request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export interface AuthUser {
  id: string;
  email: string;
  role: string;
  createdAt?: number;
}

export async function register(email: string, password: string) {
  const res = await api.post<{ user: AuthUser; token: string }>(
    "/auth/register",
    { email, password },
  );
  return res.data;
}

export async function login(email: string, password: string) {
  const res = await api.post<{ user: AuthUser; token: string }>("/auth/login", {
    email,
    password,
  });
  return res.data;
}

export async function getMe() {
  const res = await api.get<{ user: AuthUser }>("/auth/me");
  return res.data;
}

export { api };
