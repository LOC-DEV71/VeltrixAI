export function isFreeIpDenied(error: unknown) {
  return (error as {response?: {data?: {error?: {code?: string}}}})?.response?.data?.error?.code === 'FREE_IP_ACCOUNT_LIMIT';
}
