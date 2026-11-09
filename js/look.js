// The page's own numbers: animation, sound, colors, the server's address and voice chat.
// The rules' numbers are in js/config.js, which only the server loads (owner, 2026-11-06).
export const Look = {
  // animation speed in the panel: the pause between moves (ms) times the factor; a piece's
  // hop takes HOP_SHARE of that pause. "fast" is the speed of version 1.
  ANIM_PAUSE: 650,
  ANIM_SPEEDS: { slow: 2.4, medium: 1.6, fast: 1 },
  HOP_SHARE: 0.22,
  // loudness of the sound effects (js/sound.js), 0..1; players switch them on or off in the ribbon
  SOUND_VOLUME: 0.7,
  // piece colors (red, blue, green, yellow, purple, teal, pink, black); the 8-color board uses all,
  // the others the first 6 or 4. Yellow is 15% darker than before (owner, 2026-11-02). The admin may
  // change each one for every game (admin page, saved on the server: GET /api/settings).
  PIECE_COLORS: ["#d9534f", "#2f7fd0", "#4f9a2a", "#cea70d", "#6a5ccf", "#159a7a", "#ec5fa8", "#2a2a2e"],
  // the board's own colors on the 6- and 8-color boards: its surface and its edge (the 4-color board
  // keeps its classic cream and red unless the admin sets them). The admin may change both too.
  BOARD_COLORS: ["#f0e6c8", "#b59c6c"],
  // the points ring and bar of a pawn, per pawn color (as PIECE_COLORS): light turquoise on red,
  // yellow on blue, light pink on green, navy on yellow, yellow on purple, coral on teal, light green
  // on pink, light sky blue on black. The admin may change each one too (owner, 2026-11-09).
  // the stacked rings (points look "stack") are see-through so the pawn's own color shows through
  // them: their default opacity, 0..1 (owner, 2026-11-09); the admin may change it (20..100%)
  STACK_OPACITY: 0.6,
  // the head color of a pawn in the points look "head": the head turns from the pawn color to this
  // one as the pawn wins points, again after general (owner, 2026-11-09). Per pawn color, like
  // RING_COLORS (the same stand-out colors; none of them grey or silver, the general star's color).
  // The admin may change each one; every color is allowed for now (owner, 2026-11-09).
  HEAD_COLORS: ["#9ff0f0", "#ffd84a", "#ffb3e0", "#1f3a93", "#ffe066", "#ff9f8a", "#b6ffb0", "#8fdcff"],
  // a marshal's orb over the star in the points look "head": its opacity and size at marshal and
  // at its brightest, reached HEAD_GLOW.SPAN times the general-to-marshal points later
  HEAD_GLOW: { OPACITY0: 0.45, OPACITY1: 1, SCALE0: 0.7, SCALE1: 1.35, SPAN: 1 },
  RING_COLORS: ["#9ff0f0", "#ffd84a", "#ffb3e0", "#1f3a93", "#ffe066", "#ff9f8a", "#b6ffb0", "#8fdcff"],
  // the online server (v2); a page served by another host (such as the downloaded file) asks it
  SERVER_URL: "https://supermensch-dev.ndaneshi.workers.dev",
  // voice chat in online games (js/voice.js): the microphone's bit rate (Opus, bit/s; about 15 MB an
  // hour), the loudness that lights a speaker's chip (0..1, RMS), how long it stays lit (ms), and how
  // often the loudness is measured (ms); RETRY_MS: how long a broken connection or a stopped voice
  // waits before it is started again (ms); STATS_MS: how often a line of numbers goes to the voice log
  VOICE: { BITRATE: 32000, SPEAK_LEVEL: 0.02, SPEAK_HOLD_MS: 400, TICK_MS: 120, RETRY_MS: 3000, STATS_MS: 10000 },
};
