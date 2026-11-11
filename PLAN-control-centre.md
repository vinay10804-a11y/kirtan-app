# Plan: Control Centre and lock-screen playback on iPhone

Written 11 Nov 2026 as the starting point for the next session (Fable, with iPhone Mirroring).

**For Vinoda Govinda, in plain English.** Some Play and Pause presses in Control Centre still don't
work. The worst case: you pause inside the app, leave it, and later press Play in Control Centre.
Nothing happens until you open the app. This plan tells the next session what's already known, what
was tried, and what to try next. The work starts by re-testing everything on your iPhone, so we know
exactly what's broken today.

To start, open a new Claude session in the **kirtan-app.nosync** folder, pick Fable, and type:
*"Read PLAN-control-centre.md and work through it with iPhone Mirroring."* If you've seen other
bugs, add them under "Other bugs" at the bottom first, or just tell Fable.

---

## 0. Before touching anything (for Claude)

- Read CLAUDE.md, especially these entries:
  - "Play in Control Centre after pausing there"
  - "Play in Control Centre after another app's video"
  - "Switching to another app on iPhone"
  - "Phone run-through on the owner's own iPhone" (how to test through Mirroring)
- Code in `site/app.js` (search for these names, as line numbers drift):
  - Media Session handlers: `setActionHandler`, the `pause:` / `stop:` handlers that call
    `keepAwake.start()`.
  - `keepAwake` (the Web Audio tone, the `kk-open-copy` retire logic, `closedCopy`).
  - `watchAudioSession`, `interruption`, `carryOn`, `pausedAt`.
  - `recovery`, `resumeAfterDrop`, `resume()`, `recordingEnded`, `seekTo()`.
  - `audioListeners` / `recordListeners`, which a retired copy uses to drop its listeners.
- Usual workflow:
  - Work on a branch. Publish with `./publish.sh --no-fetch` (build, `tools/check.mjs`, deploy) and
    test on the live site, https://kirtans.kirtan-app.workers.dev.
  - Commit with the Co-Authored-By line. Ask the owner before pushing, opening a PR or merging.
  - Never commit `tools/lecture-lengths.json` or `tools/lecture-transcripts.json`; the
    transcription job changes them all the time.
  - Cloudflare is signed in with a key in `.env`. Never print or commit it.
- The owner isn't technical. Write to him in plain English, and keep him updated during long
  tests.

### Rules on the owner's iPhone (through iPhone Mirroring)
- Only open and use the Kirtans app ("SNS + GK").
- Never touch another app's card in the app switcher. Never press Play on another app's Now
  Playing entry in Control Centre (one seen there: "Kirtan Premi & Amala / Nāma Rahasya").
- Don't change his favourites or playlists.
- Open the app switcher from the Home Screen, not from inside the app, so the SNS + GK card is in
  the middle.
- Mirroring mechanics (from CLAUDE.md):
  - Taps work in the background with the app_* tools.
  - Control Centre and the Home Screen are in Mirroring's View menu.
  - Sound comes out of the Mac.
  - Drags don't scroll; the scroll wheel works only with full-screen control.
- Anything with WhatsApp, other apps' videos or headphones: ask the owner to do that part himself.

### The iOS Simulator (connected by the owner, 11 Nov)
An **iPhone 18 Pro simulator (iOS 27.2)** is booted on the Mac and connected to Claude. Drive it
with the `mcp__Claude_Code_iOS_Simulator__control` tool:
- `attach` first, so the owner can watch;
- `open_url` to open https://kirtans.kirtan-app.workers.dev;
- add it to the Home Screen through Safari's Share button, so it runs as the home-screen app like
  on his phone;
- `screenshot`, `tap` and `swipe` to drive it. Control Centre is a swipe down from the top-right
  corner.

**Use the simulator for:**
- quick checks after each publish, before the owner's phone;
- the app's own buttons and screens;
- rehearsing each scenario's taps;
- watching the console. Safari on the Mac → Develop menu → the simulator lets you inspect the page
  directly: console, breakpoints, `navigator.audioSession`. That's often quicker than the beacon in
  step 2.

**Don't trust it for the actual bug.** The freezing after a pause (WebKit bug 261858), how iOS hands
out Control Centre's Now Playing, audio-session interruptions, the lock screen and headphones all
come from the real phone's power and audio system. The simulator, running on the Mac, may not
behave the same. So:
- a fix that works in the simulator is only a candidate;
- the pass marks in step 6 are measured on **the owner's iPhone through Mirroring**;
- if the simulator and the phone disagree, the phone wins. Note the difference in CLAUDE.md for
  next time.

**One possible extra (owner's choice; it changes a setting on his phone, so ask first):** with
Settings → Apps → Safari → Advanced → Web Inspector turned on, the Mac's Safari Develop menu can
inspect the app running on his real iPhone (cable, or the same Wi-Fi once paired). That gives real
logs from the real phone without the beacon.

## 1. Re-test everything first, before changing code

Run each scenario on the live app and fill in the table, so the baseline is known. Run it on the
owner's iPhone. You can rehearse each one in the simulator first, and noting where the simulator
differs is useful too. A "pass" means the sound resumes at the same moment, and Control Centre and
the app both show it playing.

| # | Scenario | Status as of 8 Nov | Runs | Result |
|---|---|---|---|---|
| A | Play a kirtan, leave the app, **pause in Control Centre**, wait 2 min, Play in Control Centre | Fixed (`keepAwake`), passed 4/4 | 3 | |
| B | As A, but wait **25 min** (past keepAwake's 20-minute limit) | Expected to fail: Play arrives only when the app is opened | 1 | |
| C | Play, **pause inside the app**, go to the Home Screen, wait 1 min, Play in Control Centre | **Not fixed** (the owner's main complaint) | 5 | |
| D | As C, but press Play within 5 s of leaving | Should pass: the app hasn't frozen yet | 2 | |
| E | Lock the phone while playing, pause on the lock screen, wait 2 min, Play on the lock screen | Should pass, same as A | 3 | |
| F | Owner plays a WhatsApp video while the kirtan plays, then presses Play in Control Centre | Probably broken: see step 4 | 2 | |
| G | Pause, close the app from the app switcher, open it again, leave, Play in Control Centre | Fixed (retire): passed once; check only one copy plays | 3 | |
| H | Next and previous in Control Centre while in the background; a recording ending while locked moves on | Believed fine; regression check | 2 | |
| I | A and C again with a **lecture** (lecture player: 15/30-second skips) | Untested | 2 each | |
| J | AirPods pause, then play (owner only) | Untested | 2 | |

For each run, note:
- what Control Centre showed (title, Play or Pause icon);
- whether sound came out of the Mac;
- the log lines from step 2.

## 2. Logging from the phone (temporary)

What happens on the phone can only be seen by logging it. Earlier this was done with a "beacon":
- The app sends small JSON messages with `navigator.sendBeacon` to a temporary Worker route.
- The route logs them with `console.log`.
- You read them live with `npx wrangler tail kirtans --format pretty`.

Do the same:
- **Log these:**
  - `visibilitychange`;
  - audio `play` / `playing` / `pause` / `waiting` / `error` / `ended`;
  - every Media Session action as it arrives, with `navigator.userActivation.isActive`;
  - `navigator.audioSession` `statechange` (its `type` and `state`);
  - `keepAwake` start, stop and retire, and the AudioContext's `state`;
  - `audio.paused`, `currentTime` and `readyState` with each of the above.
- **Tag each line** with the copy id (`me` in keepAwake) and a timestamp.
- **Route name:** `check.mjs` fails the publish if `pb-debug` appears in app.js or the worker. That's
  on purpose, so a debug route never ships, so use another name (e.g. `/api/pbdbg`). Remove all of it
  before the final commit, and add the name you used to that check.

## 3. Fix C: pause inside the app, then Play in Control Centre later

**What's known (8 Nov):**
- **Freezing:** about 15 s after a pause with the app hidden, iOS freezes it (WebKit bug 261858).
  From then on, a Control Centre Play only arrives when the app is opened.
- **Why keepAwake doesn't cover C:** keepAwake's tone stops the freeze, so Play does arrive. But
  WebKit marks a media element that is *paused when the page becomes hidden* as interrupted
  (`MediaElementSession::visibilityChanged`, an EnteringBackground interruption). It then holds
  `play()` until the page is visible again. That's why A (paused while already hidden) works and C
  (paused while visible) doesn't.
- **Control Centre presses count as taps** (`userActivation.isActive` was true).
- **Starting audio while hidden:** an AudioContext can start while hidden with no tap.

**Already tried. Don't repeat these as they were:**
1. A second `<audio>` looping silence to keep the app awake. iOS showed the silence as what was
   playing. Never use a second *playing* audio element.
2. keepAwake started on leaving the app after an in-app pause. The app stayed awake and Play
   arrived, but `play()` stayed held until the app was opened.
3. On Play, moving the recording to a fresh `<audio>` made with `document.createElement`. Failed.
4. On Play, moving it to a fresh `<audio>` made in a blank document (`freshAudio`). Worked 2 times
   out of 5. In the other 3, Control Centre switched to another app's Now Playing entry. Taken out.

**Try next, in this order.** Build each behind a flag. Publish, check it in the simulator, then run
C five times plus A three times on the iPhone to catch regressions. Log the results in the table and
in CLAUDE.md.

1. **Read the WebKit source first (cheap, may settle it).** Look for anything other than becoming
   visible that ends an EnteringBackground interruption for a media element. Places to look:
   - `MediaElementSession`, `PlatformMediaSession` (`beginInterruption` / `endInterruption`,
     `didReceiveRemoteControlCommand`, `canReceiveRemoteControlCommands`);
   - `MediaSessionManagerCocoa` / `MediaSessionManageriOS`;
   - `HTMLMediaElement::play` (the path that defers it).
   The source is at github.com/WebKit/WebKit. If a remote Play command can end the interruption
   under some condition (for example, the element being the now-playing session), arrange for that
   condition.
2. **Swap at the moment of leaving, not at Play.** When the page becomes hidden with a recording
   paused inside the app:
   - start keepAwake;
   - straight away, make the fresh `<audio>` (the blank-document version from try 4), with the same
     `src` and `currentTime`, never played;
   - unload the old element (`removeAttribute('src')` and `load()`), as `retire()` does;
   - re-apply the Media Session metadata and handlers.
   On Play, play the fresh element. The thinking:
   - the fresh element never saw the page being hidden, so it isn't interrupted;
   - doing the swap early gives iOS time to keep our app as the Now Playing app. The 3 failed runs
     of try 4 may have been iOS moving to another app in the gap between the swap and Play.
   Listeners must move to the new element too: `audioListeners` already records every lasting one.
3. **"Soft pause": the element is never paused while the app is visible.** Pressing Pause in the
   app doesn't call `audio.pause()`. Instead it:
   - mutes the element (`audio.muted`; iOS ignores `volume`);
   - remembers the position;
   - sets `navigator.mediaSession.playbackState = 'paused'`.
   Play seeks back to the remembered position and unmutes. After 20 minutes it becomes a real pause.
   Spike this first (10 minutes): mute, leave the app, wait 60 s. Does `timeupdate` keep coming, and
   does a Control Centre Play arrive? iOS may suspend muted media in the background, and if so this
   idea is dead.
   If the spike passes, it's a bigger change:
   - every `audio.paused` check in app.js needs a helper;
   - progress, history and continue-listening sync must ignore the muted time;
   - the end-of-recording loop logic (`recordingEnded`) must not fire;
   - it keeps streaming, about 14 MB per 20 minutes;
   - check that Control Centre shows a Play button, not Pause.
4. **If none reaches 5 out of 5:** stop. Tell the owner it's a limit of iPhone web apps, and make
   the fallback smooth. Tapping the recording in Control Centre opens the app, and it then plays by
   itself; check that still works. Write down what was tried in CLAUDE.md. An App Store app is the
   only full fix, and the owner doesn't want one.

## 4. Fix F: another app's sound, then Play in Control Centre

- **The problem:** the carry-on after an interruption (`watchAudioSession` / `carryOn`) waits for
  `navigator.audioSession.state === 'interrupted'`. On the owner's iPhone, `statechange` fires but
  `state` reads as undefined, so it never triggers.
- **Fix:** use the `statechange` event plus the audio's own `pause` event timing (a pause the user
  didn't make) as the signal instead. Then test with a WhatsApp video; the owner does the WhatsApp
  part.
- **Also decide:** should keepAwake start after a system interruption too? Today it starts only from
  the Media Session pause handler. Make sure the tone doesn't fight the other app's sound. With the
  session type "auto" it should mix, but check.

## 5. Decide B: Play after more than 20 minutes

keepAwake gives up after 20 minutes to save battery. Ask the owner whether he wants longer
(30 or 60 minutes). If he does:
- measure the battery use of an hour of the tone (Settings → Battery);
- change the `20 * 60e3` in keepAwake and the check in `tools/check.mjs` that requires it.

## 6. Finishing

- **Pass mark:**
  - C passes 5 out of 5, or the owner accepts the fallback;
  - A and E pass 3 out of 3;
  - G plays from one copy only;
  - H and I show no regressions.
- **Clean up:** remove the logging route and calls, and keep the `check.mjs` guard against them.
- **Record it:**
  - Rewrite the CLAUDE.md entry: what worked and what didn't, with run counts.
  - Add `check.mjs` checks for whatever ships, as for keepAwake.
  - Update NOTES.md: tick off or update the "To fix" item.
- Publish, commit, and ask the owner before pushing and merging.

## Other bugs (owner: add any you've seen, one per line)

- Known, never tested on a real iPhone: playing from Instagram, then coming back (CLAUDE.md,
  "Switching to another app on iPhone").
- Known, left as it was: on phones, lecture rows with a Video button wrap onto two lines.
-

## Findings, 11 Nov evening (work in progress on branch `control-centre-fix`)

Tested on the owner's iPhone through Mirroring with a beacon (`/api/ccdbg`, `DBG()` in app.js, both temporary).
- The simulator can't test this: its Control Centre has no player and its lock screen shows no buttons.
- `navigator.audioSession.state` reads `undefined` on his iPhone; `statechange` does fire.
- Cause, from WebKit's source: `MediaElementSession::visibilityChanged` interrupts a player that isn't
  playing when the page is hidden. That also clears `hasPlayedAudiblySinceLastInterruption`, so the app
  stops counting as one that plays sound; the iPhone freezes it about 10 s later and Play never arrives
  (the log shows no `action:play`, and Control Centre may switch to another app).
- Tried: the player as a `<video>` drawn to a canvas (`elementIsHidden()` is false while
  `isVisibleForCanvas`; `drawImage(video,0,0,1,1,0,0,1,1)` didn't throw). Can't yet tell if it stops the
  interruption, because the app still froze.
- The stay-awake tone is the blocker. Started 2 s after leaving: `ctx.state` is "interrupted" at once.
  Started at the in-app pause (state "running"): it turns "interrupted" the moment the app is left
  (WebKit: Web Audio has BackgroundProcessPlaybackRestricted). It only survives when started in the
  background from a Control Centre press, which is why pausing there works.
- Next ideas: (1) on leaving after an in-app pause, keep the app "playing" another way than Web Audio,
  e.g. the `<video>` itself playing on at a point where it is silent is not possible, so test whether the
  canvas-visible `<video>` alone keeps Control Centre's Play arriving in the ~10 s before the freeze, and
  whether a Play that arrives late (on opening the app) can be made to start at once; (2) check if
  `ctx.resume()` from the `statechange` to "interrupted" brings the tone back; (3) otherwise accept the
  limit and make "tap the recording in Control Centre to open the app, it plays by itself" reliable.
- Also seen: Control Centre shows 10-second skip buttons for a paused kirtan, not previous/next.
