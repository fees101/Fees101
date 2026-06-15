'use client'

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts'

interface ClassData {
  class: string
  expected: number
  collected: number
  percentage: number
}

interface CollectionChartProps {
  data: ClassData[]
}

function formatNaira(value: number): string {
  if (value >= 1000000) return `₦${(value / 1000000).toFixed(1)}M`
  if (value >= 1000) return `₦${(value / 1000).toFixed(0)}K`
  return `₦${value}`
}

export default function CollectionChart({ data }: CollectionChartProps) {
  if (data.length === 0) {
    return (
      <div className="bg-white p-6 rounded-xl border border-gray-200">
        <h2 className="text-navy font-semibold text-lg mb-2">Collection by Class</h2>
        <p className="text-gray-500 text-sm">No invoices yet for current term.</p>
      </div>
    )
  }

  return (
    <div className="bg-white p-6 rounded-xl border border-gray-200">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-navy font-semibold text-lg">Collection by Class</h2>
        <p className="text-gray-500 text-sm">Current term</p>
      </div>

      <ResponsiveContainer width="100%" height={Math.max(300, data.length * 40)}>
        <BarChart
          data={data}
          layout="vertical"
          margin={{ top: 10, right: 40, left: 10, bottom: 10 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" horizontal={false} />
          <XAxis 
            type="number" 
            tickFormatter={formatNaira}
            tick={{ fill: '#6B7280', fontSize: 12 }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis 
            type="category" 
            dataKey="class"
            tick={{ fill: '#0D1B36', fontSize: 13 }}
            axisLine={false}
            tickLine={false}
            width={100}
          />
          <Tooltip 
            formatter={(value) => formatNaira(Number(value))}
            contentStyle={{
              backgroundColor: 'white',
              border: '1px solid #E5E7EB',
              borderRadius: '8px',
              fontSize: '13px',
            }}
            labelStyle={{ color: '#0D1B36', fontWeight: 600 }}
          />
          <Bar dataKey="collected" name="Collected" radius={[0, 4, 4, 0]}>
            {data.map((entry, index) => (
              <Cell 
                key={`cell-${index}`} 
                fill={entry.percentage >= 80 ? '#5AD8A6' : entry.percentage >= 50 ? '#F59E0B' : '#EF4444'}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      <div className="flex items-center gap-4 mt-4 text-xs">
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-sm bg-mint"></div>
          <span className="text-gray-500">≥80% collected</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-sm bg-amber-500"></div>
          <span className="text-gray-500">50-79%</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-sm bg-red-500"></div>
          <span className="text-gray-500">{'<'}50%</span>
        </div>
      </div>
    </div>
  )
}