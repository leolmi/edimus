/** Guide for the AI using the edimus tools (resource edimus://guide). */
export const GUIDE = `# edimus — guide for AI agents

edimus is a **non-destructive multitrack audio montage editor**. The original audio files are
never modified: a *montage* references them and describes how to compose them into one mono or
stereo mix, which is rendered by \`export\`.

## Data model
- **montage** — what one edimus window holds (one montage per window, see list_instances).
  Saved as a \`.edimus\` JSON file, or as a \`.edimuspack\` bundle (zip with copies of the audio
  files, to move or share it); \`dirty\` = unsaved changes.
- **web instances** — edimus also runs in the browser (instances with pid 0). There files have no
  real paths (\`/<id>/<name>\`, from the user's own dialogs or drops): \`open\` works only with
  paths returned by \`get_state\`, and \`save\`/\`export\` to a new path become a download in
  the browser. Export formats there: wav, mp3, ogg.
- **source** — an original audio file (id, path, format, length, detected or manual tempo).
  The tempo may be **variable**: a bar map pins the start of some bars (or of every bar) on the
  audio, for songs recorded without a steady tempo; the grid, \`get_beats\` and the beat snap follow
  it, and \`bpm\` is then the average. It belongs to the source, so every clip of the file shares it.
- **track** — a horizontal lane: name, muted, solo, \`volumeDb\` (volume of the whole track), and clips.
  Tracks are mixed together; when any track is soloed only soloed tracks are heard.
- **clip** — a portion of a source placed on a track:
  - \`start\` / \`end\`: position on the **timeline** (seconds);
  - \`offset\`: where the portion begins inside the source (source seconds);
  - \`rate\`: speed factor (2 = twice as fast, half as long); \`pitch\`: semitones;
    \`mode\`: \`stretch\` (pitch kept, Rubber Band) or \`varispeed\` (pitch follows speed);
  - \`bpm\`: tempo heard in the clip (source BPM × rate, the average one when variable), when known;
  - \`envelope\`: its volume points (fades).
- **envelope** — volume points of a **clip**, in **dB** (0 dB = unchanged, -100 dB or less =
  silence, max +6 dB), given and returned in timeline seconds. It belongs to the clip: moving,
  splitting, trimming or changing the speed of the clip carries it along. Before the first point
  and after the last one the level stays constant. A segment can be bent (\`curve\`: 0 straight,
  >0 slow start, <0 fast start).

## Audible length
\`get_state\` reports \`audible\`: the span of the mix that is heard (from the first to the last
sound above -60 dBFS of the audible tracks, envelopes and volumes included), i.e. the length
without leading and trailing silences; null while some audio is not ready.

## Units
- All times are **seconds**: timeline seconds unless the parameter says "source".
- Volumes are **dB**; speed is a factor; pitch is semitones; tempo is BPM.

## Workflow
1. \`get_state\` to read ids, positions and lengths (call it again after edits when unsure).
2. Edit with the tools: each call is **one undoable step** (\`undo\` / \`redo\`), also visible in
   the window. Tools return the affected items with their new values.
3. Check with \`analyze_levels\`, \`find_silence\`, \`get_beats\` or \`snapshot\` (an image of the timeline).
4. \`save\` the montage and/or \`export\` the mixdown.

## Recipes
- Remove silence at the start: \`find_silence\` on the clip → \`trim_clip\` its start to the end of
  the first silence (or \`delete_range\` to shift everything back).
- Fade out the last 5 s of a clip: \`fade\` {clipId, type: "out", length: 5}.
- Lower a track by 6 dB: \`set_track\` {trackId, volumeDb: -6}.
- Join two songs: \`open\` both (two tracks), \`move_clip\` the second to start where the first ends
  minus the crossfade, then \`crossfade\` {clipIds: [first, second]} over their whole overlap.
- Show the user what you mean: \`select\` {clipIds, from, to} highlights clips and a range in the window.
- Beat-match: \`align_tempo\` {referenceClipId, targetClipIds, alignBars: true}; check with \`get_beats\`.
- Keep a portion only: \`crop\` {from, to}.
- Grid drifting away from the music (tempo not steady): \`set_bar_map\` {clipId, action: "track"};
  where it is still off, \`pin\` the bar on its hit {bar, time} (and \`track\` again: pins stay);
  \`reset\` removes every pin (back to the starting steady grid), \`clearAuto\` only the tracked ones.
  Keep the work for other montages: \`save\` writes the bar file next to the audio (\`song.mp3.edimusbars\`),
  used by itself when the audio is opened again on the desktop; \`load\` reads it.
  \`align_tempo\` changes the speed only, it cannot make a drifting song steady.

## Good practice
- Never assume ids: read them from \`get_state\`.
- Prefer one precise call over many small ones; check the result before the next step.
- \`new_montage\`, \`open\` of a montage and overwriting files are refused while there are unsaved
  changes or existing files, unless you pass \`discard\` / \`overwrite\`: ask the user first.
`;
