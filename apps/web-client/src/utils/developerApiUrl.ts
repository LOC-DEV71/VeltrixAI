import {api} from '../api';

// Dùng cùng VITE_API_URL với client, hỗ trợ cả URL tuyệt đối và /api qua proxy.
export const developerApiUrl = new URL(api.defaults.baseURL || '/api', window.location.origin)
  .href.replace(/\/+$/, '') + '/developer/v1';
