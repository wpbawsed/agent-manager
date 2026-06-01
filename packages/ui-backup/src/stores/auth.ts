import { defineStore } from "pinia";
import { ref } from "vue";
import { login, register, getMe, type AuthUser } from "@/api/auth";

export const useAuthStore = defineStore("auth", () => {
  const user = ref<AuthUser | null>(null);
  const token = ref<string | null>(localStorage.getItem("token"));
  const loading = ref(false);

  function setAuth(u: AuthUser, t: string) {
    user.value = u;
    token.value = t;
    localStorage.setItem("token", t);
  }

  function clearAuth() {
    user.value = null;
    token.value = null;
    localStorage.removeItem("token");
  }

  async function doLogin(email: string, password: string) {
    loading.value = true;
    try {
      const data = await login(email, password);
      setAuth(data.user, data.token);
    } finally {
      loading.value = false;
    }
  }

  async function doRegister(email: string, password: string) {
    loading.value = true;
    try {
      const data = await register(email, password);
      setAuth(data.user, data.token);
    } finally {
      loading.value = false;
    }
  }

  async function fetchMe() {
    if (!token.value) return;
    loading.value = true;
    try {
      const data = await getMe();
      user.value = data.user;
    } catch {
      clearAuth();
    } finally {
      loading.value = false;
    }
  }

  const isLoggedIn = () => !!token.value;

  return {
    user,
    token,
    loading,
    doLogin,
    doRegister,
    fetchMe,
    clearAuth,
    isLoggedIn,
  };
});
