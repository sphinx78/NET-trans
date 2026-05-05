// NET-Trans — YouTube Caption Bridge
// Runs in the PAGE context (not the extension context) to extract
// caption track URLs from YouTube's internal player API.
(function() {
  function getCaptionTracks() {
    try {
      var player = document.querySelector('#movie_player');
      if (player && typeof player.getPlayerResponse === 'function') {
        var resp = player.getPlayerResponse();
        if (resp && resp.captions && resp.captions.playerCaptionsTracklistRenderer) {
          return resp.captions.playerCaptionsTracklistRenderer.captionTracks || [];
        }
      }
    } catch(e) {}
    try {
      if (window.ytInitialPlayerResponse &&
          window.ytInitialPlayerResponse.captions &&
          window.ytInitialPlayerResponse.captions.playerCaptionsTracklistRenderer) {
        return window.ytInitialPlayerResponse.captions.playerCaptionsTracklistRenderer.captionTracks || [];
      }
    } catch(e) {}
    return [];
  }

  var tracks = getCaptionTracks();
  var simplified = [];
  for (var i = 0; i < tracks.length; i++) {
    simplified.push({
      baseUrl: tracks[i].baseUrl || '',
      languageCode: tracks[i].languageCode || '',
      name: (tracks[i].name && tracks[i].name.simpleText) ? tracks[i].name.simpleText : (tracks[i].languageCode || ''),
      kind: tracks[i].kind || ''
    });
  }
  window.postMessage({ type: 'NT_YT_CAPTION_TRACKS', tracks: simplified }, '*');
})();
