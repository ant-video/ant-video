import { sizeFormate } from '../../index'

const getFirstSize = (file, keys) => {
  for (const key of keys) {
    const size = file?.[key]
    if (size != null && size !== 0 && size !== '0') return size
  }
  return null
}

const addQuality = (types, _types, type, rawSize, force = false) => {
  if (_types[type]) return
  if (!force && (rawSize == null || rawSize === 0 || rawSize === '0')) return
  if (force && (rawSize == null || rawSize === 0 || rawSize === '0')) return

  const numericSize = Number(rawSize)
  const size = !Number.isFinite(numericSize) || numericSize <= 0
    ? null
    : sizeFormate(numericSize)
  const qualityInfo = { size }
  types.push({ type, ...qualityInfo })
  _types[type] = qualityInfo
}

export const buildQualitys = (file = {}) => {
  const types = []
  const _types = {}

  addQuality(types, _types, '128k', file.size_128mp3)
  addQuality(types, _types, '320k', file.size_320mp3)
  addQuality(types, _types, 'flac', file.size_flac)

  const hiresSize = getFirstSize(file, ['size_hires', 'size_hires24bit', 'size_flac24bit'])
  addQuality(types, _types, 'flac24bit', hiresSize, true)
  addQuality(types, _types, 'hires', hiresSize, true)
  addQuality(types, _types, 'atmos', getFirstSize(file, ['size_atmos', 'size_dolby', 'size_dolby_atmos', 'size_360ra']), true)
  addQuality(types, _types, 'atmos_plus', getFirstSize(file, ['size_atmos_plus', 'size_dolby_plus', 'size_360ra_plus']), true)
  addQuality(types, _types, 'master', getFirstSize(file, ['size_master', 'size_ai_master', 'size_new']), true)

  return { types, _types }
}
