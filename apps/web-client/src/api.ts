import axios from 'axios';
import toast from 'react-hot-toast';
import { errorMessage } from './utils/userMessages';

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:3001/api',
  withCredentials: true,
});

let csrfToken: string | null = null;
let isRefreshing = false;
let failedQueue: any[] = [];

const processQueue = (error: any, token: string | null = null) => {
  failedQueue.forEach(prom => {
    if (error) {
      prom.reject(error);
    } else {
      prom.resolve(token);
    }
  });
  failedQueue = [];
};

api.interceptors.request.use(async (config) => {
  if (['post', 'put', 'delete', 'patch'].includes(config.method?.toLowerCase() || '')) {
    if (!csrfToken) {
      try {
        const res = await axios.get((config.baseURL || 'http://localhost:3001/api') + '/v1/auth/csrf', { withCredentials: true });
        csrfToken = res.headers['x-csrf-token'] || res.data?.data?.csrfToken;
      } catch (err) {
        console.error('Failed to fetch CSRF token', err);
      }
    }
    if (csrfToken) {
      config.headers['x-csrf-token'] = csrfToken;
    }
  }
  return config;
});

api.interceptors.response.use(
  (response) => {
    if (response.headers['x-csrf-token']) {
      csrfToken = response.headers['x-csrf-token'];
    }
    return response;
  },
  async (error) => {
    const localized=errorMessage(error);
    error.message=localized;
    if(error.response?.data?.error) error.response.data.error.message=localized;
    const originalRequest = error.config || {};
    
    // Save csrfToken if present in error response
    if (error.response?.headers && error.response.headers['x-csrf-token']) {
      csrfToken = error.response.headers['x-csrf-token'];
    }

    if (error.response?.status === 401 && !originalRequest._retry) {
      if (originalRequest.url?.includes('/auth/refresh') || originalRequest.url?.includes('/auth/login')) {
        return Promise.reject(error);
      }

      if (isRefreshing) {
        return new Promise(function(resolve, reject) {
          failedQueue.push({ resolve, reject });
        }).then(() => {
          if (csrfToken && ['post', 'put', 'delete', 'patch'].includes(originalRequest.method?.toLowerCase() || '')) {
             originalRequest.headers['x-csrf-token'] = csrfToken;
          }
          return api(originalRequest);
        }).catch(err => Promise.reject(err));
      }

      originalRequest._retry = true;
      isRefreshing = true;

      try {
        await api.post('/v1/auth/refresh');
        isRefreshing = false;
        processQueue(null);
        
        if (csrfToken && ['post', 'put', 'delete', 'patch'].includes(originalRequest.method?.toLowerCase() || '')) {
           originalRequest.headers['x-csrf-token'] = csrfToken;
        }
        return api(originalRequest);
      } catch (err: any) {
        processQueue(err, null);
        isRefreshing = false;
        if (err.response?.status === 401 || err.response?.status === 409) {
          const publicPages = ['/', '/login', '/docs', '/developer', '/pricing', '/voices', '/chinh-sach-dieu-khoan'];
          if (!publicPages.includes(window.location.pathname)) {
            toast.error("Phiên đăng nhập đã hết hạn.");
            window.location.href = '/login';
          }
        }
        return Promise.reject(err);
      }
    }
    
    return Promise.reject(error);
  }
);
