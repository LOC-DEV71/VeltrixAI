export function SubscriptionProgress({ period, free }: { period: any; free: boolean }) {
  if (free) return <p className="mt-5 text-xs text-slate-500">Gói miễn phí không có thời hạn đăng ký tháng hoặc năm.</p>;
  if (!period) return <p className="mt-5 rounded-xl bg-slate-50 p-4 text-sm text-slate-500">Chưa có thông tin thời hạn đăng ký cho gói này.</p>;
  const date = (value: string) => new Date(value).toLocaleDateString('vi-VN', { timeZone:'Asia/Saigon' });
  const percentage = (n: number) => Math.max(0,Math.min(100,Number.isFinite(n) ? n : 0));
  const bar = (label: string, value: number, start: string, end: string) => {
    const amount=percentage(value);
    return <div className="space-y-2" key={label}>
      <div className="flex justify-between items-center gap-3 text-sm"><span className="font-medium text-slate-700">{label}</span><span className="font-semibold text-indigo-600">{amount.toLocaleString('vi-VN',{maximumFractionDigits:2})}% còn lại</span></div>
      <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={amount} aria-valuetext={`${amount.toLocaleString('vi-VN')}% thời hạn còn lại`} className="h-2.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-violet-500 transition-all" style={{width:`${amount}%`}}/></div>
      <p className="text-xs text-slate-500">{date(start)} → {date(end)}</p>
    </div>;
  };
  return <div className="mt-5 rounded-xl border border-indigo-100 bg-indigo-50/30 p-4 space-y-5">
    {period.status === 'EXPIRED' ? <p className="text-sm text-amber-700">Thời hạn đăng ký đã kết thúc.</p> : period.status === 'SCHEDULED' ? <p className="text-sm text-slate-600">Gói bắt đầu từ {date(period.startsAt)}.</p> : <p className="text-sm text-slate-600">Thời hạn gói còn {period.remainingDays.toLocaleString('vi-VN')} ngày, đến {date(period.endsAt)}.</p>}
    {bar('Thời hạn tháng hiện tại',period.monthlyRemainingPercent,period.monthStartsAt,period.monthEndsAt)}
    {period.billingCycle === 'YEARLY' && bar('Thời hạn gói năm · 12 tháng',period.remainingPercent,period.startsAt,period.endsAt)}
    <p className="text-xs text-slate-400">Phần trăm thể hiện thời gian còn lại của gói, không phải số Credit. Gói năm giảm khoảng 8,33% mỗi tháng.</p>
  </div>;
}
