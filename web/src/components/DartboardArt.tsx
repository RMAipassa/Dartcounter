const numbers = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5]

function point(radius: number, degrees: number) {
  const angle = degrees * Math.PI / 180
  return `${(200 + radius * Math.cos(angle)).toFixed(2)} ${(200 + radius * Math.sin(angle)).toFixed(2)}`
}

function segment(inner: number, outer: number, angle: number) {
  const start = angle - 9
  const end = angle + 9
  return `M ${point(outer, start)} A ${outer} ${outer} 0 0 1 ${point(outer, end)} L ${point(inner, end)} A ${inner} ${inner} 0 0 0 ${point(inner, start)} Z`
}

export default function DartboardArt() {
  return (
    <svg className="heroBoard" viewBox="0 0 400 400" aria-hidden="true">
      <circle cx="200" cy="200" r="194" fill="none" stroke="#829bff" strokeOpacity=".26" strokeDasharray="2 7" />
      <circle cx="200" cy="200" r="176" fill="#201f45" stroke="#7b79b8" />
      <circle cx="200" cy="200" r="143" fill="none" stroke="#9e9cc8" />
      {numbers.map((number, index) => {
        const angle = index * 18 - 90
        const [x, y] = point(159, angle).split(' ')
        const bed = index % 2 ? '#f3ecda' : '#272652'
        const wire = index % 2 ? '#9179e0' : '#d0fa6c'
        return (
          <g key={number} stroke="#211f46" strokeWidth=".8">
            <path d={segment(14, 81, angle)} fill={bed} />
            <path d={segment(81, 89, angle)} fill={wire} />
            <path d={segment(89, 132, angle)} fill={bed} />
            <path d={segment(132, 141, angle)} fill={wire} />
            <text x={x} y={y} stroke="none" textAnchor="middle" dominantBaseline="central" fill="#eeedff" fontSize="13" fontWeight="700">{number}</text>
          </g>
        )
      })}
      <circle cx="200" cy="200" r="14" fill="#9179e0" stroke="#211f46" />
      <circle cx="200" cy="200" r="6" fill="#d0fa6c" stroke="#211f46" />
    </svg>
  )
}
