import { eapiRequest } from './utils/index'
import { formatSingerName } from '../utils'

export default {
    /**
     * 搜索歌手
     * @param {*} str 搜索关键词
     * @param {*} page 页码
     * @param {*} limit 每页数量
     * @param {*} retryNum 重试次数
     */
    searchSinger(str, page = 1, limit = 20, retryNum = 0) {
        if (++retryNum > 3) return Promise.reject(new Error('try max num'))
        const searchRequest = eapiRequest('/api/cloudsearch/pc', {
            s: str,
            type: 100, // 歌手类型
            limit,
            total: page === 1, // 仅第一页返回总数
            offset: limit * (page - 1),
        })
        return searchRequest.promise.then(({ body: result }) => {
            if (!result || result.code !== 200) return this.searchSinger(str, page, limit, retryNum)
            const list = this.handleSingerResult(result.result.artists)
            return {
                list,
                total: result.result.artistCount || 0,
                allPage: Math.ceil((result.result.artistCount || 0) / limit),
                limit,
                source: 'wy',
            }
        })
    },

    /**
     * 搜索专辑
     * @param {*} str 搜索关键词
     * @param {*} page 页码
     * @param {*} limit 每页数量
     * @param {*} retryNum 重试次数
     */
    searchAlbum(str, page = 1, limit = 20, retryNum = 0) {
        if (++retryNum > 3) return Promise.reject(new Error('try max num'))
        const searchRequest = eapiRequest('/api/cloudsearch/pc', {
            s: str,
            type: 10, // 专辑类型
            limit,
            total: page === 1,
            offset: limit * (page - 1),
        })
        return searchRequest.promise.then(({ body: result }) => {
            if (!result || result.code !== 200) return this.searchAlbum(str, page, limit, retryNum)
            const list = this.handleAlbumResult(result.result.albums)
            return {
                list,
                total: result.result.albumCount || 0,
                allPage: Math.ceil((result.result.albumCount || 0) / limit),
                limit,
                source: 'wy',
            }
        })
    },

    /**
     * 搜索歌单
     * @param {*} str 搜索关键词
     * @param {*} page 页码
     * @param {*} limit 每页数量
     * @param {*} retryNum 重试次数
     */
    searchPlaylist(str, page = 1, limit = 20, retryNum = 0) {
        if (++retryNum > 3) return Promise.reject(new Error('try max num'))
        const searchRequest = eapiRequest('/api/cloudsearch/pc', {
            s: str,
            type: 1000, // 歌单类型
            limit,
            total: page === 1,
            offset: limit * (page - 1),
        })
        return searchRequest.promise.then(({ body: result }) => {
            if (!result || result.code !== 200) return this.searchPlaylist(str, page, limit, retryNum)
            const list = this.handlePlaylistResult(result.result.playlists)
            return {
                list,
                total: result.result.playlistCount || 0,
                allPage: Math.ceil((result.result.playlistCount || 0) / limit),
                limit,
                source: 'wy',
            }
        })
    },

    /**
     * 处理搜索歌手结果格式
     * @param {*} rawList 原始结果列表
     */
    handleSingerResult(rawList) {
        if (!rawList) return []
        return rawList.map(item => ({
            id: item.id,
            name: item.name,
            picUrl: item.picUrl,
            alias: item.alias,
            albumSize: item.albumSize,
            source: 'wy',
        }))
    },

    /**
     * 处理搜索专辑结果格式
     * @param {*} rawList 原始结果列表
     */
    handleAlbumResult(rawList) {
        if (!rawList) return []
        return rawList.map(item => ({
            id: item.id,
            name: item.name,
            picUrl: item.picUrl,
            artistName: item.artist ? item.artist.name : (item.artists ? formatSingerName(item.artists) : ''),
            artistId: item.artist ? item.artist.id : (item.artists ? item.artists[0].id : null),
            size: item.size,
            publishTime: item.publishTime,
            source: 'wy',
        }))
    },

    /**
     * 处理搜索歌单结果格式
     * @param {*} rawList 原始结果列表
     */
    handlePlaylistResult(rawList) {
        if (!rawList) return []
        return rawList.map(item => ({
            id: item.id,
            name: item.name,
            picUrl: item.coverImgUrl,
            playCount: item.playCount,
            trackCount: item.trackCount,
            creator: item.creator ? item.creator.nickname : '',
            source: 'wy',
        }))
    },
}
