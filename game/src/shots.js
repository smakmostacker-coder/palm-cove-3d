// Deterministic screenshot staging for Palm Cove.
//
// The capture harness loads the game with a query string such as
// "?shot=drive". When a known shot name is present this module puts
// the game into exactly the scene the screenshot needs, using only
// the small api surface that main.js hands over. Without a "shot"
// parameter it does nothing at all, so normal play is untouched.
//
// Staging is best-effort by design: any failure inside a staged
// scene is swallowed so a broken screenshot setup can never stop
// the real game from booting.

function readShotName(search) {
  if (!search) return null;
  let text = String(search);
  if (text.charAt(0) === '?') text = text.slice(1);
  const params = new URLSearchParams(text);
  const name = params.get('shot');
  if (!name) return null;
  const trimmed = name.trim().toLowerCase();
  return trimmed === '' ? null : trimmed;
}

function callApi(api, name, args) {
  const fn = api ? api[name] : null;
  if (typeof fn !== 'function') return false;
  fn.apply(null, args || []);
  return true;
}

export function applyShotStaging(search, api) {
  const shot = readShotName(search);
  if (!shot) return false;

  try {
    switch (shot) {
      case 'title':
        // The menu over the live city backdrop is the staged shot,
        // so no game is started and nothing else is touched.
        return true;

      case 'drive':
        callApi(api, 'startGame', ['vera']);
        // startGame wakes the lead inside the home interior, and the
        // facilities system clamps the player into that room while
        // G.interior is set — a bare teleport outdoors is pulled back
        // into the room on the next frame. Staging outdoors must clear
        // the interior flag, exactly as leaving through the door does.
        if (api && api.G) api.G.interior = null;
        callApi(api, 'teleport', [40, 13, 0]);
        callApi(api, 'enterNearestCar', []);
        return true;

      case 'chase':
        callApi(api, 'startGame', ['vera']);
        // Same interior clamp as 'drive': clear it before teleporting.
        if (api && api.G) api.G.interior = null;
        callApi(api, 'teleport', [30, 10, 0]);
        callApi(api, 'setWanted', [4]);
        return true;

      case 'map':
        callApi(api, 'startGame', ['vera']);
        callApi(api, 'openMap', []);
        return true;

      default:
        // An unknown shot name is not a staging request the game
        // knows how to honour, so report it as unhandled.
        return false;
    }
  } catch (err) {
    // Staging must never break the game: log for the capture log
    // and still claim the shot so boot continues normally.
    if (typeof console !== 'undefined' && console.warn) {
      console.warn('shot staging failed', shot, err);
    }
    return true;
  }
}

export default applyShotStaging;
