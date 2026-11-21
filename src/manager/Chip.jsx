const TONES = {
  green: 'bg-emerald-50 text-emerald-800 border border-emerald-200',
  red: 'bg-red-50 text-[#DC2626] border border-red-200',
  amber: 'bg-amber-50 text-amber-800 border border-amber-200',
  grey: 'bg-slate-50 text-[#64748B] border border-[#E2E8F0]',
}

export default function Chip({ tone = 'grey', children }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold ${TONES[tone] || TONES.grey}`}>
      {children}
    </span>
  )
}
