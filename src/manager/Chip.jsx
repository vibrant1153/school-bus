const TONES = {
  green: 'bg-[#DFF3E8] text-live',
  red: 'bg-[#FBE3E3] text-[#A62B2B]',
  grey: 'bg-[#E3E8EE] text-muted',
}

export default function Chip({ tone = 'grey', children }) {
  return (
    <span className={`inline-block rounded-full px-3 py-1 text-[13px] font-bold ${TONES[tone]}`}>
      {children}
    </span>
  )
}