import * as THREE from 'three'

/**
 * Overbite 分析数据类型
 */
export interface OverbitePoint {
  fdi: number
  type: 'incisal_edge' | 'gingiva_margin'
  type_cn: string
  point: [number, number, number]
}

export interface OverbiteAnalysisData {
  teeth_points: OverbitePoint[]
  measurements: {
    H_total: number // 总高度（下牙切端到龈缘的距离）
    H_overlap: number // 覆合高度（上下牙切端垂直重叠）
    ratio: number // 覆合比例
    diagnosis: string // 诊断结果
    severity: string // 严重程度
  }
}

/**
 * 从完整诊断数据中提取 Overbite 数据
 */
export function extractOverbiteData(diagnosisData: {
  pathology_results?: Array<{ task_name: string; diagnosis_result?: unknown }>
}): OverbiteAnalysisData | null {
  const overbiteResult = diagnosisData.pathology_results?.find(
    (result) => result.task_name === 'overbite',
  )

  if (!overbiteResult?.diagnosis_result) {
    return null
  }

  return overbiteResult.diagnosis_result as OverbiteAnalysisData
}

/**
 * 创建垂直测量线（带双箭头和标签）
 * @param startPoint 起始点
 * @param endPoint 结束点
 * @param label 标签文字
 * @param color 颜色
 * @returns 测量线组对象
 */
function createVerticalMeasurementLine(
  startPoint: THREE.Vector3,
  endPoint: THREE.Vector3,
  label: string,
  color: number = 0x00ff00,
): THREE.Group {
  const group = new THREE.Group()

  // 1. 创建主线
  const lineGeometry = new THREE.BufferGeometry().setFromPoints([startPoint, endPoint])
  const lineMaterial = new THREE.LineBasicMaterial({
    color: color,
    linewidth: 2,
    depthTest: false,
  })
  const line = new THREE.Line(lineGeometry, lineMaterial)
  line.renderOrder = 999
  group.add(line)

  // 2. 计算方向
  const direction = new THREE.Vector3().subVectors(endPoint, startPoint).normalize()
  const arrowSize = 0.5

  // 3. 创建起点和终点的箭头
  createArrowHead(startPoint, direction.clone().negate(), arrowSize, color, group)
  createArrowHead(endPoint, direction, arrowSize, color, group)

  // 4. 创建标签
  const centerPoint = new THREE.Vector3().addVectors(startPoint, endPoint).multiplyScalar(0.5)
  const sprite = createMeasurementLabel(label, color)
  sprite.position.copy(centerPoint)
  sprite.position.x += 2 // 向右偏移避免遮挡线
  group.add(sprite)

  return group
}

/**
 * 创建箭头
 */
function createArrowHead(
  point: THREE.Vector3,
  direction: THREE.Vector3,
  size: number,
  color: number,
  parent: THREE.Group,
): void {
  const arrowAngle = Math.PI / 6 // 30度

  // 创建垂直于方向的向量（在XY平面）
  const perpendicular = new THREE.Vector3(-direction.y, direction.x, 0).normalize()

  // 箭头的两个端点
  const offset1 = new THREE.Vector3().addVectors(
    direction.clone().multiplyScalar(-size * Math.cos(arrowAngle)),
    perpendicular.clone().multiplyScalar(size * Math.sin(arrowAngle)),
  )

  const offset2 = new THREE.Vector3().addVectors(
    direction.clone().multiplyScalar(-size * Math.cos(arrowAngle)),
    perpendicular.clone().multiplyScalar(-size * Math.sin(arrowAngle)),
  )

  const arrowPoint1 = new THREE.Vector3().addVectors(point, offset1)
  const arrowPoint2 = new THREE.Vector3().addVectors(point, offset2)

  // 创建箭头的两条线
  const arrowLine1 = new THREE.BufferGeometry().setFromPoints([point, arrowPoint1])
  const arrowLine2 = new THREE.BufferGeometry().setFromPoints([point, arrowPoint2])

  const arrowMaterial = new THREE.LineBasicMaterial({
    color: color,
    linewidth: 2,
    depthTest: false,
  })

  const arrow1 = new THREE.Line(arrowLine1, arrowMaterial)
  const arrow2 = new THREE.Line(arrowLine2, arrowMaterial)
  arrow1.renderOrder = 999
  arrow2.renderOrder = 999

  parent.add(arrow1)
  parent.add(arrow2)
}

/**
 * 创建测量标签
 */
function createMeasurementLabel(text: string, color: number): THREE.Sprite {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 128
  const ctx = canvas.getContext('2d')!

  // 绘制半透明背景
  ctx.fillStyle = 'rgba(255, 255, 255, 0.9)'
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  // 绘制边框
  const colorStr = '#' + color.toString(16).padStart(6, '0')
  ctx.strokeStyle = colorStr
  ctx.lineWidth = 4
  ctx.strokeRect(0, 0, canvas.width, canvas.height)

  // 绘制文字
  ctx.font = 'Bold 40px Arial'
  ctx.fillStyle = colorStr
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, canvas.width / 2, canvas.height / 2)

  const texture = new THREE.CanvasTexture(canvas)
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
  })
  const sprite = new THREE.Sprite(material)
  sprite.scale.set(3, 1.5, 1)
  sprite.renderOrder = 999

  return sprite
}

/**
 * 创建标记点
 */
function createMarkerPoint(position: THREE.Vector3, color: number, label: string): THREE.Group {
  const group = new THREE.Group()

  // 创建球体标记
  const sphereGeometry = new THREE.SphereGeometry(0.3, 16, 16)
  const sphereMaterial = new THREE.MeshBasicMaterial({
    color: color,
    depthTest: false,
  })
  const sphere = new THREE.Mesh(sphereGeometry, sphereMaterial)
  sphere.position.copy(position)
  sphere.renderOrder = 999
  group.add(sphere)

  // 创建文字标签
  const sprite = createMeasurementLabel(label, color)
  sprite.position.copy(position)
  sprite.position.z += 1
  sprite.scale.set(2, 1, 1)
  group.add(sprite)

  return group
}

/**
 * 渲染 Overbite 深覆合分析测量
 * @param overbiteData Overbite 分析数据
 * @param scene 场景对象
 * @returns 测量线组对象
 */
export function renderOverbiteAnalysis(
  overbiteData: OverbiteAnalysisData,
  scene: THREE.Scene,
): THREE.Group {
  const measurementsGroup = new THREE.Group()
  measurementsGroup.name = 'overbite_measurements'

  const { teeth_points, measurements } = overbiteData

  // 整理点位数据
  const pointsMap: Record<string, THREE.Vector3> = {}

  teeth_points.forEach((point) => {
    const key = `${point.fdi}_${point.type}`
    pointsMap[key] = new THREE.Vector3(point.point[0], point.point[1], point.point[2])
  })

  console.log('Overbite 点位数据:', pointsMap)
  console.log('Overbite 测量数据:', measurements)

  // 找到关键点
  // 通常使用中切牙（11, 21, 31, 41）来测量
  const upperIncisalKeys = Object.keys(pointsMap).filter(
    (key) => (key.startsWith('11_') || key.startsWith('21_')) && key.includes('incisal_edge'),
  )
  const lowerIncisalKeys = Object.keys(pointsMap).filter(
    (key) => (key.startsWith('41_') || key.startsWith('31_')) && key.includes('incisal_edge'),
  )
  const lowerGingivaKeys = Object.keys(pointsMap).filter(
    (key) => (key.startsWith('41_') || key.startsWith('31_')) && key.includes('gingiva_margin'),
  )

  if (
    upperIncisalKeys.length === 0 ||
    lowerIncisalKeys.length === 0 ||
    lowerGingivaKeys.length === 0
  ) {
    console.warn('Overbite 数据不完整，无法渲染')
    return measurementsGroup
  }

  // 取平均点（如果有多个前牙）
  const getAveragePoint = (keys: string[]) => {
    const sum = keys.reduce(
      (acc, key) => {
        const point = pointsMap[key]
        return point ? acc.add(point) : acc
      },
      new THREE.Vector3(0, 0, 0),
    )
    return sum.divideScalar(keys.length)
  }

  const upperIncisalAvg = getAveragePoint(upperIncisalKeys)
  const lowerIncisalAvg = getAveragePoint(lowerIncisalKeys)
  const lowerGingivaAvg = getAveragePoint(lowerGingivaKeys)

  // 1. 绘制 H_total（下牙切端到龈缘的总高度）- 绿色
  const hTotalLine = createVerticalMeasurementLine(
    lowerGingivaAvg,
    lowerIncisalAvg,
    `H_total: ${measurements.H_total.toFixed(1)}mm`,
    0x00ff00, // 绿色
  )
  measurementsGroup.add(hTotalLine)

  // 2. 绘制 H_overlap（上下牙切端垂直重叠）- 红色
  // H_overlap 是从下牙切端向上的距离
  const overlapEndPoint = lowerIncisalAvg.clone()
  overlapEndPoint.y += measurements.H_overlap // 向上（Y轴正方向）

  const hOverlapLine = createVerticalMeasurementLine(
    lowerIncisalAvg,
    overlapEndPoint,
    `H_overlap: ${measurements.H_overlap.toFixed(1)}mm`,
    0xff0000, // 红色
  )
  measurementsGroup.add(hOverlapLine)

  // 3. 标记关键点
  // 上牙切端点 - 蓝色
  upperIncisalKeys.forEach((key) => {
    const point = pointsMap[key]
    if (point) {
      const fdi = key.split('_')[0]
      const marker = createMarkerPoint(point, 0x0000ff, `上${fdi}切端`)
      measurementsGroup.add(marker)
    }
  })

  // 下牙切端点 - 黄色
  lowerIncisalKeys.forEach((key) => {
    const point = pointsMap[key]
    if (point) {
      const fdi = key.split('_')[0]
      const marker = createMarkerPoint(point, 0xffff00, `下${fdi}切端`)
      measurementsGroup.add(marker)
    }
  })

  // 下牙龈缘点 - 青色
  lowerGingivaKeys.forEach((key) => {
    const point = pointsMap[key]
    if (point) {
      const fdi = key.split('_')[0]
      const marker = createMarkerPoint(point, 0x00ffff, `下${fdi}龈缘`)
      measurementsGroup.add(marker)
    }
  })

  // 4. 显示诊断结果
  const diagnosisLabel = createMeasurementLabel(
    `${measurements.diagnosis} (${measurements.severity})`,
    0xffffff,
  )
  diagnosisLabel.position.copy(upperIncisalAvg)
  diagnosisLabel.position.y += 5 // 向上偏移
  diagnosisLabel.scale.set(5, 2.5, 1)
  measurementsGroup.add(diagnosisLabel)

  scene.add(measurementsGroup)
  console.log(`Overbite 分析渲染完成`)

  return measurementsGroup
}

/**
 * 切换 Overbite 测量的显示
 * @param scene 场景对象
 * @param visible 是否显示
 */
export function toggleOverbiteAnalysis(scene: THREE.Scene, visible: boolean): void {
  const measurementGroup = scene.getObjectByName('overbite_measurements')
  if (measurementGroup) {
    measurementGroup.visible = visible
  }
}
