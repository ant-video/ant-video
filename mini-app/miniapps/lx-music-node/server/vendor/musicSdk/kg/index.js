import leaderboard from './leaderboard'
import { apis } from '../api-source' // 现在已适配服务器端
import songList from './songList'
import musicSearch from './musicSearch'
import pic from './pic'
import lyric from './lyric'
import hotSearch from './hotSearch'
import comment from './comment'
import tipSearch from './tipSearch'

const kg = {
  tipSearch,
  leaderboard,
  songList,
  musicSearch,
  hotSearch,
  comment,
  getMusicUrl(songInfo, type) {
    // 使用 api-source 获取 API（优先自定义源）
    return apis('kg').getMusicUrl(songInfo, type)
  },
  getLyric(songInfo) {
    return lyric.getLyric(songInfo)
  },
  // getLyric(songInfo) {
  //   return apis('kg').getLyric(songInfo)
  // },
  getPic(songInfo) {
    return pic.getPic(songInfo)
  },
  getMusicDetailPageUrl(songInfo) {
    return `https://www.kugou.com/song/#hash=${songInfo.hash}&album_id=${songInfo.albumId}`
  },
  // getPic(songInfo) {
  //   return apis('kg').getPic(songInfo)
  // },
}

export default kg
