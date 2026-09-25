import { apis } from '../api-source' // 现在已适配服务器端
import leaderboard from './leaderboard'
import songList from './songList'
import musicSearch from './musicSearch'
import pic from './pic'
import lyric from './lyric'
import hotSearch from './hotSearch'
import comment from './comment'
import tipSearch from './tipSearch'

const mg = {
  tipSearch,
  songList,
  musicSearch,
  leaderboard,
  hotSearch,
  comment,
  getMusicUrl(songInfo, type) {
    // 使用 api-source 获取 API（优先自定义源）
    return apis('mg').getMusicUrl(songInfo, type)
  },
  getLyric(songInfo) {
    return lyric.getLyric(songInfo)
  },
  getPic(songInfo) {
    return pic.getPic(songInfo)
  },
  getMusicDetailPageUrl(songInfo) {
    return `http://music.migu.cn/v3/music/song/${songInfo.copyrightId}`
  },
}

export default mg
