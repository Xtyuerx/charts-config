import type { ViewLabel, StrategyConfig } from './types'
import * as THREE from 'three'

// ==================== 场景和材质配置 ====================

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
    specular: 0x555555,
    shininess: 100,
    reflectivity: 0.5,
    side: THREE.DoubleSide,
  },
  tooth: {
    color: 0xffffff,
    specular: 0x555555,
    shininess: 30,
    side: THREE.DoubleSide,
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
  font: '200px Arial',
  textColor: '#000000',
  scale: { x: 2, y: 2, z: 1 },
} as const

// ==================== 视角配置 ====================

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

// ==================== 牙齿相关配置 ====================

/**
 * 牙齿颜色映射表
 */
export const TOOTH_COLOR_MAP: Record<number, number> = {
  // 上颌右侧
  11: 0xff0000,
  12: 0xff4500,
  13: 0xff8c00,
  14: 0xffa500,
  15: 0xffff00,
  16: 0x9acd32,
  17: 0x00ff00,
  18: 0x00ced1,
  // 上颌左侧
  21: 0x1e90ff,
  22: 0x0000ff,
  23: 0x8a2be2,
  24: 0x9370db,
  25: 0xba55d3,
  26: 0xff00ff,
  27: 0xff1493,
  28: 0xc71585,
  // 下颌右侧
  31: 0xdc143c,
  32: 0xb22222,
  33: 0x8b0000,
  34: 0xcd5c5c,
  35: 0xf08080,
  36: 0xfa8072,
  37: 0xe9967a,
  38: 0xffa07a,
  // 下颌左侧
  41: 0x20b2aa,
  42: 0x48d1cc,
  43: 0x40e0d0,
  44: 0x00ffff,
  45: 0x00bfff,
  46: 0x87ceeb,
  47: 0x87cefa,
  48: 0xb0c4de,
}

/**
 * 牙齿配对关系 - [上颌, 下颌]
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

// ==================== 点位类型颜色映射 ====================

/**
 * 不同类型点位的颜色配置
 */
export const POINT_TYPE_COLORS: Record<string, number> = {
  // 切端点
  incisal_edge: 0xff0000,
  // 龈缘点
  gingiva_margin: 0x00ff00,
  // 牙尖点
  cusp_mb: 0x0000ff,
  cusp_db: 0x00ffff,
  cusp_ml: 0xff00ff,
  // 质心
  center_tooth: 0xffff00,
  // 边界点
  boundary_mesial: 0xff6b6b,
  boundary_distal: 0x6bff6b,
  // 尖牙牙尖
  canine_cusp: 0xff8800,
  // 前磨牙颊尖
  buccal_cusp_p: 0x8800ff,
  // 中央窝
  center_fossa: 0x00ff88,
  center_crown: 0x88ff00,
  // 颊沟点
  mesial_buccal_groove: 0xff0088,
}

// ==================== 渲染器默认配置 ====================

/**
 * 点渲染器默认配置
 */
export const DEFAULT_POINT_OPTIONS = {
  color: 0xff0000,
  size: 0.5,
  opacity: 1.0,
  showLabel: false,
}

/**
 * 线渲染器默认配置
 */
export const DEFAULT_LINE_OPTIONS = {
  color: 0x00ff00,
  lineWidth: 2,
  dashed: false,
  dashSize: 0.5,
  gapSize: 0.3,
  showArrows: false,
  showLabel: false,
}

/**
 * 标签渲染器默认配置
 */
export const DEFAULT_LABEL_OPTIONS = {
  fontSize: 14,
  fontColor: '#ffffff',
  backgroundColor: '#285e50',
  padding: 8,
  borderRadius: 4,
}
