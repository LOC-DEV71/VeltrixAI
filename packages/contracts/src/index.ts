export interface HealthResponse {
  status: 'ok' | 'error' | 'blocked';
  timestamp: string;
}

export interface BaseResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
}
