import { sizeFormate } from '../../index'

const hasQualityInfo = (info) => info != null

const getSize = (info) => {
  const size = info?.size
  if (size == null || size === 0 || size === '0') return null
  const numericSize = Number(size)
  return !Number.isFinite(numericSize) || numericSize <= 0 ? null : sizeFormate(numericSize)
}

const addQuality = (types, _types, type, size) => {
  if (_types[type]) return
  const qualityInfo = { size }
  types.push({ type, ...qualityInfo })
  _types[type] = qualityInfo
}

export const buildQualitys = (item = {}, privilege = {}) => {
  const types = []
  const _types = {}

  const maxbr = Number(privilege?.maxbr || item.privilege?.maxbr || 0)
  if (maxbr >= 128000 || item.l) addQuality(types, _types, '128k', getSize(item.l))
  if (maxbr >= 320000 || item.h) addQuality(types, _types, '320k', getSize(item.h))
  if (maxbr >= 999000 || item.sq) addQuality(types, _types, 'flac', getSize(item.sq))

  const hiresSize = getSize(item.hr)
  if (hasQualityInfo(item.hr)) {
    addQuality(types, _types, 'flac24bit', hiresSize)
    addQuality(types, _types, 'hires', hiresSize)
  }
  if (hasQualityInfo(item.jyEffect || item.sky)) addQuality(types, _types, 'atmos', getSize(item.jyEffect || item.sky))
  if (hasQualityInfo(item.jm || item.jymaster)) addQuality(types, _types, 'master', getSize(item.jm || item.jymaster))

  return { types, _types }
}
