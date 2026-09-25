import { httpFetch } from '../../request'
// import getMusicInfo from './musicInfo'

const decodeName = (str = '') => {
  if (!str) return ''
  return str.replace(/&#(\d+);/g, (match, dec) => {
    return String.fromCharCode(dec)
  }).replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
}

const b64DecodeUnicode = (str) => {
  return Buffer.from(str, 'base64').toString('utf8')
}

export default {
  regexps: {
    matchLrc: /.+"lyric":"([\w=+/]*)".+/,
  },
  getLyric(songmid) {
    const songId = songmid.songmid || songmid
    const requestObj = httpFetch(`https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?songmid=${songId}&g_tk=5381&loginUin=0&hostUin=0&format=json&inCharset=utf8&outCharset=utf-8&platform=yqq`, {
      headers: {
        Referer: 'https://y.qq.com/portal/player.html',
      },
    })
    requestObj.promise = requestObj.promise.then(({ body }) => {
      if (body.code != 0 || !body.lyric) return Promise.reject(new Error('Get lyric failed'))
      return {
        lyric: decodeName(b64DecodeUnicode(body.lyric)),
        tlyric: decodeName(b64DecodeUnicode(body.trans)),
      }
    })
    return requestObj
  },
}
