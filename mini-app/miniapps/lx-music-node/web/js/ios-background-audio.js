/**
 * iOS Background Audio Keep-Alive Module
 *
 * 解决 iOS Safari 息屏断播问题。
 * 原理：在 Web Audio 图末端（analyser 之后）桥接 MediaStreamDestination，
 * 并将其输出流赋给隐藏 <audio> 元素的 srcObject，使 iOS 将其识别为活跃媒体流，
 * 从而在息屏/后台状态维持音频会话。
 *
 * 仅在 iOS 设备上激活，其他平台为 no-op。
 * 加载顺序：须在 sound-effects.js 之前加载。
 */
window.iOSBackgroundAudio = (function () {

    // 检测是否为 iOS 设备（含 iPad OS 桌面模式）
    function isIOS() {
        const ua = navigator.userAgent;
        const isIPad = /iPad/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
        return /iPhone|iPod/.test(ua) || isIPad;
    }

    let streamDestination = null;
    let anchorAudio = null;
    let isActive = false;
    let _audioContext = null;

    /**
     * 初始化 iOS 后台播放保活桥接。
     * 由 sound-effects.js 的 init() 末尾调用，在 Web Audio 图构建完成后执行。
     * @param {AudioContext} audioContext - 已有的 AudioContext
     * @param {AnalyserNode} analyserNode - 音频图末端的 Analyser 节点（输出到 destination 之前）
     */
    function init(audioContext, analyserNode) {
        if (!isIOS()) return;
        if (isActive) return;

        _audioContext = audioContext;

        try {
            // 1. [核心优化] 在 iOS 上断开默认输出，强制所有音频流向 MediaStreamDest
            // 这能防止系统在后台时因 AudioContext.destination 的调度冲突而挂起
            if (analyserNode && audioContext.destination) {
                try {
                    analyserNode.disconnect(audioContext.destination);
                    console.log('[iOSAudio] 🌐 Disconnected Analyser from default destination for exclusive routing.');
                } catch (e) {
                    console.warn('[iOSAudio] Could not disconnect default destination:', e);
                }
            }

            // 2. 创建 MediaStreamDestination
            streamDestination = audioContext.createMediaStreamDestination();
            analyserNode.connect(streamDestination);

            // 3. 创建隐藏的 anchor <audio> 元素，作为 iOS 媒体会话锚点
            anchorAudio = document.createElement('audio');
            anchorAudio.id = 'ios-audio-anchor';
            anchorAudio.setAttribute('playsinline', '');
            anchorAudio.setAttribute('webkit-playsinline', '');
            anchorAudio.muted = false; // 必须非静音，才能使 iOS 维持活跃媒体会话
            anchorAudio.volume = 1.0;
            anchorAudio.style.cssText = 'position:absolute;width:1px;height:1px;opacity:0.01;pointer-events:none;';
            document.body.appendChild(anchorAudio);

            // 4. 赋值 srcObject
            anchorAudio.srcObject = streamDestination.stream;

            // 5. 同步主音频播放/暂停状态
            const mainAudio = document.getElementById('audio-player');
            if (mainAudio) {
                mainAudio.addEventListener('play', onMainPlay);
                mainAudio.addEventListener('pause', onMainPause);
            }

            // 6. 监听 AudioContext 状态（处理 iOS 系统中断恢复）
            audioContext.addEventListener('statechange', onContextStateChange);

            // 7. 监听页面可见性（增强切回时的恢复）
            document.addEventListener('visibilitychange', onVisibilityChange);

            isActive = true;
            console.log('[iOSAudio] ✅ MediaStreamDestination bridge initialized. Exclusive routing active.');

            // 8. 立即尝试启动（此时应在用户手势上下文中）
            syncAnchorWithContext();

        } catch (e) {
            console.error('[iOSAudio] Failed to initialize:', e);
        }
    }

    function onMainPlay() {
        if (!_audioContext) return;
        if (_audioContext.state === 'suspended') {
            _audioContext.resume().then(() => {
                console.log('[iOSAudio] AudioContext resumed on play.');
                syncAnchorWithContext();
            });
        } else {
            syncAnchorWithContext();
        }
    }

    function onMainPause() {
        // 主动暂停时也同步 anchor 状态，但保持 context 为空载运行
        syncAnchorWithContext();
    }

    function onContextStateChange() {
        if (!_audioContext) return;
        console.log('[iOSAudio] AudioContext state shifted to:', _audioContext.state);
        syncAnchorWithContext();
    }

    function onVisibilityChange() {
        if (document.visibilityState === 'visible' && _audioContext && _audioContext.state === 'suspended') {
            console.log('[iOSAudio] Page visible, attempting to resume AudioContext...');
            _audioContext.resume().then(syncAnchorWithContext);
        }
    }

    /**
     * 关键逻辑：将 anchorAudio 的播放状态与 AudioContext 严格同步。
     * 解决“爱爱爱爱”循环卡顿的关键：在 Context 挂起时强制暂停 anchorAudio。
     */
    function syncAnchorWithContext() {
        if (!anchorAudio || !_audioContext) return;

        const mainAudio = document.getElementById('audio-player');
        const shouldPlay = _audioContext.state === 'running' && mainAudio && !mainAudio.paused;

        if (shouldPlay) {
            if (anchorAudio.paused) {
                const p = anchorAudio.play();
                if (p) {
                    p.then(() => {
                        console.log('[iOSAudio] Anchor playing - buffer flowing.');
                        // 启动后立即触发一次全局进度同步，纠正 iOS 可能产生的直播流偏见
                        if (typeof window.updatePositionState === 'function') {
                            window.updatePositionState();
                            // [iOS Fix] 延迟 500ms 再追更一次，确保 Safari 的媒体状态已稳定
                            setTimeout(window.updatePositionState, 500);
                        }
                    }).catch(e => {
                        if (e.name !== 'NotAllowedError') console.warn('[iOSAudio] Play failed:', e);
                    });
                }
            }
        } else {
            // 当 Context 被挂起（后台/锁屏）或主音乐暂停时，立即暂停 anchor 防止缓冲循环
            if (!anchorAudio.paused) {
                anchorAudio.pause();
                console.log('[iOSAudio] Anchor paused - stopping potential buffer loop.');
            }
        }
    }

    return {
        init,
        ensureAnchorPlaying: syncAnchorWithContext,
        isActive: () => isActive,
        isIOS,
    };

})();
