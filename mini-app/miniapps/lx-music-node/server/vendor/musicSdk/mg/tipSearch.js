import { createHttpFetch } from './utils'

export default {
  requestObj: null,
  cancelTipSearch() {
    if (this.requestObj && this.requestObj.cancelHttp) this.requestObj.cancelHttp()
  },
  tipSearchBySong(str) {
    this.cancelTipSearch()
    this.requestObj = createHttpFetch(`https://app.u.nf.migu.cn/pc/resource/content/tone_search_suggest/v1.0?text=${encodeURIComponent(str)}`)
    return this.requestObj.then(data => {
      return data.songList || []
    }).catch(() => [])
  },
  handleResult(rawData) {
    if (!rawData) return []
    return rawData.map(info => info.songName)
  },
  async search(str) {
    return this.tipSearchBySong(str).then(result => this.handleResult(result))
  },
}
