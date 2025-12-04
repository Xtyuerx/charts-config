import type { ViewLabel } from './types'

/**
 * 牙齿颜色映射表 - 为不同牙齿编号定义颜色
 */
export const TOOTH_COLOR_MAP: Record<number, number> = {
  // 上颌右侧
  11: 0xff0000, // 红色
  12: 0xff4500, // 橙红色
  13: 0xff8c00, // 深橙色
  14: 0xffa500, // 橙色
  15: 0xffff00, // 黄色
  16: 0x9acd32, // 黄绿色
  17: 0x00ff00, // 绿色
  18: 0x00ced1, // 深青色

  // 上颌左侧
  21: 0x1e90ff, // 道奇蓝
  22: 0x0000ff, // 蓝色
  23: 0x8a2be2, // 蓝紫色
  24: 0x9370db, // 中紫色
  25: 0xba55d3, // 中兰花紫
  26: 0xff00ff, // 品红色
  27: 0xff1493, // 深粉红
  28: 0xc71585, // 中紫红色

  // 下颌右侧
  31: 0xdc143c, // 深红色
  32: 0xb22222, // 火砖色
  33: 0x8b0000, // 深红色
  34: 0xcd5c5c, // 印度红
  35: 0xf08080, // 浅珊瑚色
  36: 0xfa8072, // 鲑鱼色
  37: 0xe9967a, // 深鲑鱼色
  38: 0xffa07a, // 浅鲑鱼色

  // 下颌左侧
  41: 0x20b2aa, // 浅海洋绿
  42: 0x48d1cc, // 中绿宝石
  43: 0x40e0d0, // 绿松石
  44: 0x00ffff, // 青色
  45: 0x00bfff, // 深天蓝
  46: 0x87ceeb, // 天蓝色
  47: 0x87cefa, // 浅天蓝色
  48: 0xb0c4de, // 浅钢蓝色
}

/**
 * 视角标签列表
 */
export const VIEW_LABELS: ViewLabel[] = [
  { label: '前双颌', isShow: false, type: 0, key: 'full' },
  { label: '前上颌', isShow: false, type: 1, key: 'upper' },
  { label: '前下颌', isShow: false, type: 2, key: 'lower' },
  { label: '上颌', isShow: false, type: 3, key: 'upper_angle' },
  { label: '下颌', isShow: false, type: 4, key: 'lower_angle' },
  { label: '左双颌', isShow: false, type: 5, key: 'left' },
  { label: '右双颌', isShow: false, type: 6, key: 'right' },
]

/**
 * 牙齿配对关系 - 用于生成中间牙弓线
 * [上颌牙齿编号, 下颌牙齿编号]
 */
export const TOOTH_PAIRS: [number, number][] = [
  [18, 48],
  [17, 47],
  [16, 46],
  [15, 45],
  [14, 44],
  [13, 43],
  [12, 42],
  [11, 41],
  [21, 31],
  [22, 32],
  [23, 33],
  [24, 34],
  [25, 35],
  [26, 36],
  [27, 37],
  [28, 38],
]

/**
 * 场景配置
 */
export const SCENE_CONFIG = {
  background: 0xf2f2f2,
  cameraFov: 50,
  cameraNear: 0.1,
  cameraFar: 1000,
  cameraPosition: { x: 0, y: 0, z: 150 },
  modelScale: 1.5,
  sceneRotation: {
    x: -Math.PI / 2,
    z: -Math.PI / 2,
  },
} as const

/**
 * 材质配置
 */
export const MATERIAL_CONFIG = {
  jaw: {
    color: 0xffb6c1,
    opacity: 0.5,
    specular: 0x555555,
    shininess: 100,
    reflectivity: 0.5,
  },
  tooth: {
    color: 0xffffff,
    specular: 0x555555,
    shininess: 30,
  },
  lowerJaw: {
    emissive: 0x333333,
    emissiveIntensity: 0.3,
  },
} as const

/**
 * 标签配置
 */
export const LABEL_CONFIG = {
  canvas: {
    width: 256,
    height: 256,
  },
  font: '120px Arial',
  textColor: '#000000',
  scale: { x: 2, y: 2, z: 1 },
} as const

/**
 * 牙弓线配置
 */
export const ARCH_WIRE_CONFIG = {
  tubeRadius: 0.2,
  tubeSegments: 64,
  radialSegments: 8,
  color: 0xffaa44,
  roughness: 0.8,
  metalness: 0.2,
  controlPointCount: 5,
  controlPointRadius: 0.5,
  controlPointColor: '#285e50',
  curveType: 'catmullrom' as const,
  tension: 0.5,
} as const
