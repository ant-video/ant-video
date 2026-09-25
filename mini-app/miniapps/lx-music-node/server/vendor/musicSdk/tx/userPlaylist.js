import { httpFetch } from '../../request'
import { formatPlayCount } from '../../index'

export default {
    async getList(uid, tryNum = 0) {
        if (tryNum > 2) return Promise.reject(new Error('try max num'))

        const APIURL = 'https://c.y.qq.com/rsc/fcgi-bin/fcg_user_created_diss'
        const params = {
            hostuin: uid,
            sin: 0,
            size: 40,
            r: Date.now(),
            g_tk_new_20200303: 1718906646,
            g_tk: 1718906646,
            loginUin: 0,
            hostUin: 0,
            format: 'json',
            inCharset: 'utf8',
            outCharset: 'utf-8',
            notice: 0,
            platform: 'yqq.json',
            needNewCode: 0,
        }
        const url = `${APIURL}?${Object.keys(params).map(k => `${k}=${encodeURIComponent(params[k])}`).join('&')}`

        const requestObj = httpFetch(url, {
            headers: {
                host: 'c.y.qq.com',
                referer: 'https://y.qq.com/',
            },
        })

        const { body } = await requestObj.promise
        if (body.code !== 0) return this.getList(uid, ++tryNum)

        const { hostname, disslist } = body.data
        const lists = []
        const userAvatar = `//q1.qlogo.cn/g?b=qq&s=640&nk=${uid}&t=12345`
        const defaultCover = 'http://y.gtimg.cn/mediastyle/y/img/cover_qzone_130.jpg'

        disslist.forEach(item => {
            if (item.tid) {
                let img = item.diss_cover
                if (!img || img === defaultCover) img = userAvatar

                lists.push({
                    id: String(item.tid),
                    name: item.diss_name,
                    img: img,
                    total: item.song_cnt,
                    play_count: formatPlayCount(item.listen_num),
                    source: 'tx',
                })
            }
        })

        return {
            uid,
            nickname: hostname,
            avatar: `//q1.qlogo.cn/g?b=qq&s=100&nk=${uid}`,
            list: lists,
            source: 'tx',
        }
    },
}
