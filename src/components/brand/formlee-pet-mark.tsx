export function FormleePetMark({ size = 36, className = '' }: { size?: number; className?: string }) {
  return (
    <svg
      aria-hidden='true'
      className={className}
      width={size}
      height={size}
      viewBox='0 0 64 64'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
    >
      <circle cx='10' cy='34' r='6' fill='#EFF5FF' stroke='#A9C8FF' strokeWidth='2' />
      <circle cx='54' cy='34' r='6' fill='#EFF5FF' stroke='#A9C8FF' strokeWidth='2' />
      <path d='M32 13V6' stroke='#A9C8FF' strokeWidth='2.5' strokeLinecap='round' />
      <circle cx='32' cy='5' r='3.5' fill='#5EA4FF' />
      <rect x='12' y='17' width='40' height='39' rx='18' fill='#F5F8FF' stroke='#A9C8FF' strokeWidth='2' />
      <path d='M12 23L32 13L52 23L32 32L12 23Z' fill='#3678F6' />
      <path d='M29.5 29.5V36' stroke='#1F55BA' strokeWidth='4' />
      <circle cx='35' cy='37' r='2' fill='#F6C65B' />
      <ellipse cx='24' cy='39' rx='3.4' ry='4.3' fill='#16233F' />
      <ellipse cx='40' cy='39' rx='3.4' ry='4.3' fill='#16233F' />
      <circle cx='19' cy='46' r='2.4' fill='#F6A9A4' fillOpacity='.72' />
      <circle cx='45' cy='46' r='2.4' fill='#F6A9A4' fillOpacity='.72' />
      <path d='M27 49C30 53 34 53 37 49' stroke='#16233F' strokeWidth='2' strokeLinecap='round' />
      <text x='32' y='29' textAnchor='middle' fill='white' fontSize='7' fontWeight='800' fontFamily='system-ui'>F</text>
    </svg>
  )
}
