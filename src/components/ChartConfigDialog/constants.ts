import { Histogram, PieChart, TrendCharts } from '@element-plus/icons-vue'
import type { ChartConfig, ChartTypeItem, ChartMainType, CheckedChartTypeItem } from './types'

export type ChartTypeIcon = typeof Histogram | typeof TrendCharts | typeof PieChart
export const CHART_TYPES: ChartTypeItem<ChartTypeIcon>[] = [
  { name: 'bar', label: '柱状图', icon: Histogram },
  { name: 'line', label: '折线图', icon: TrendCharts },
  { name: 'pie', label: '饼图', icon: PieChart },
]

export const COLOR_THEMES: { name: string; colors: string[] }[] = [
  { name: '经典蓝绿黄红', colors: ['#1890ff', '#13c2c2', '#2fc25b', '#facc14', '#f04864'] },
  { name: '多彩鲜艳', colors: ['#722ed1', '#eb2f96', '#fa8c16', '#13c2c2', '#52c41a'] },
  { name: 'AntV 默认', colors: ['#5B8FF9', '#5AD8A6', '#5D7092', '#F6BD16', '#E8684A'] },
  { name: '森系绿灰', colors: ['#344E41', '#3A5A40', '#588157', '#A3B18A', '#DAD7CD'] },
  { name: '暖色沙漠', colors: ['#264653', '#2A9D8F', '#E9C46A', '#F4A261', '#E76F51'] },
]

export const CURRENT_CHART_MAP: Record<ChartMainType, CheckedChartTypeItem[]> = {
  bar: [
    {
      label: '分组柱状图',
      name: 'bar_group',
      imageURL: new URL('@/assets/images/bar_group.png', import.meta.url).href,
    },
    {
      label: '堆积柱状图',
      name: 'bar_stacked',
      imageURL: new URL('@/assets/images/bar_stacked.png', import.meta.url).href,
    },
    {
      label: '百分比堆积柱状图',
      name: 'bar_percent',
      imageURL: new URL('@/assets/images/bar_stacked.png', import.meta.url).href,
    },
  ],
  line: [
    {
      label: '折线图',
      name: 'line',
      imageURL: new URL('@/assets/images/line.png', import.meta.url).href,
    },
    {
      label: '平滑折线图',
      name: 'line_smooth',
      imageURL: new URL('@/assets/images/line_smooth.png', import.meta.url).href,
    },
  ],
  pie: [
    {
      label: '饼图',
      name: 'pie',
      imageURL: new URL('@/assets/images/pie.png', import.meta.url).href,
    },
    {
      label: '环形图',
      name: 'pie_donut',
      imageURL: new URL('@/assets/images/pie_donut.png', import.meta.url).href,
    },
  ],
}

export const DEFAULT_CONFIG: ChartConfig = {
  title: '销售数据统计',
  type: 'bar',
  subType: 'bar_group',
  theme: COLOR_THEMES[0],
  categoryField: 'genre',
  categorySort: 'asc',
  valueFields: ['sold'],
  colorField: 'name',
  dataSource: 0,
  legend: {
    show: true,
    position: 'top',
  },
  label: {
    show: true,
    position: 'top',
  },
  yAxis: {
    show: true,
    title: '销售额',
    min: 0,
    max: 1000,
    tickCount: 5,
    interval: 200,
  },
  xAxis: {
    show: true,
    title: '产品类别',
  },
  grid: {
    show: true,
  },
}
