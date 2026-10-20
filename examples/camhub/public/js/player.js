'use strict';

// Plays an HLS URL in a <video>. Uses hls.js where available, native HLS on Safari/iOS.
// Returns a function that stops playback and frees the player.
window.playHls = function playHls(video, src, { live = true, onError } = {}) {
  let hls = null;
  video.muted = true;
  if (window.Hls && window.Hls.isSupported()) {
    hls = new window.Hls(
      live
        ? { lowLatencyMode: true, liveSyncDurationCount: 2, liveMaxLatencyDurationCount: 5, maxBufferLength: 6 }
        : { maxBufferLength: 60 },
    );
    hls.on(window.Hls.Events.ERROR, (_, data) => {
      if (!data.fatal) return;
      if (onError) onError(data);
      // Live streams come back after a camera reconnects: retry a few seconds later.
      if (live) setTimeout(() => hls && (hls.loadSource(src), hls.startLoad()), 4000);
    });
    hls.loadSource(src);
    hls.attachMedia(video);
  } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
    video.src = src;
  } else if (onError) {
    onError({ details: 'Navegador sem suporte a HLS.' });
  }
  video.play().catch(() => {});
  return () => {
    if (hls) hls.destroy();
    hls = null;
    video.removeAttribute('src');
    video.load();
  };
};
