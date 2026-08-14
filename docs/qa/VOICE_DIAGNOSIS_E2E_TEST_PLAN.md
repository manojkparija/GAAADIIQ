# Voice Diagnosis — E2E Test Plan and Validation Report

**Version:** 1.0
**Date:** 2026-08-14
**Suite:** `apps/gaadiiq-angular/e2e/voice-diagnosis.spec.ts`
**Data:** `apps/api/tests/data/voice_e2e_seed.py`, `apps/api/tests/data/diagnosis_e2e_seed.py`
**Executed:** real Chromium → built Angular bundle → FastAPI → PostgreSQL 16 (TLS) → seeded knowledge base

---

## 1. Result

| | |
|---|---|
| Cases executed | **15** |
| Passed, full stack (API + Postgres + seeded KB) | **15** |
| Passed in CI (no API) | **11**, with 4 skipped |
| Failed | 0 |
| Runtime | 3m 07s full stack · 2m 36s CI-equivalent |

Two runs, because the suite has two honest verdicts. With a backend, all fifteen
pass. Without one — which is CI's web job — eleven pass and the four that need
an API **skip**. Skipping says "not exercised", which is true; failing would say
"broken", which is not.

**This one is end to end in the literal sense.** A real browser drives the real
Angular build; the app calls the real API; the API reads real Postgres over TLS;
the answer comes from a seeded knowledge base and is asserted *on screen*.
Nothing between the browser and the database is mocked.

The earlier `test_diagnosis_e2e.py` suite drives HTTP and is not this. It could
not have told you whether the voice button renders, whether consent appears
before the microphone opens, or whether a diagnosis reaches the page.

---

## 2. What is real and what is faked

Stated precisely, because "end to end" is worth nothing if the fakes are hidden.

| Layer | State |
|---|---|
| Browser | **Real** Chromium |
| Angular app | **Real** production build (`ng build`), served as a static bundle |
| API | **Real** FastAPI on uvicorn |
| Database | **Real** PostgreSQL 16, TLS enabled — the app requires `ssl=require` |
| Knowledge base | **Real** rows, seeded and approved through the review path |
| `SpeechRecognition` | **Faked** — the *browser API*, not the app |
| Microphone | **Faked** — `--use-fake-device-for-media-stream` |
| `speechSynthesis` | **Real** Chromium (no installed voices, so silent) |

**Why recognition is faked.** Chromium exposes `SpeechRecognition` and
`webkitSpeechRecognition` — I verified this in the browser rather than assuming
it — but headless has no microphone and no recognition backend, so no real
speech becomes text. The fake replaces the browser interface and leaves every
line of the component under test real. A test that claimed to speak aloud would
be lying about what it exercised.

---

## 3. Test data

### Audio (`voice_e2e_seed.py`)

Synthesised, not recorded. Nothing in the voice path decodes audio —
`services/stt.py` reads the WAV header for a duration estimate and forwards the
bytes — so the properties under test are header correctness, size, declared
content type and duration. A generated file expresses those exactly; a recording
expresses them by accident, and would also put a real person's voice in a public
repository.

| Fixture | Purpose |
|---|---|
| `wav(2)`, `wav(59)`, `wav(75)` | Either side of the 60-second cap (BR-IR-04) |
| `TRUNCATED_WAV` | RIFF magic, no payload — the parser must not raise |
| `NOT_AUDIO` | A PNG sent with an audio content type |
| `EMPTY` | Zero bytes |
| 10 accepted / 5 rejected content types | Including `audio/webm;codecs=opus`, what Android Chrome records |

### Transcripts

The four shapes that actually arrive from Indian drivers:

- English — *"My Maruti Swift 2019 petrol is making a grinding noise when I brake"*
- Hindi, Devanagari — *"मेरी गाड़ी स्टार्ट नहीं हो रही है"*
- Hinglish, Latin — *"gaadi mein se awaaz aa rahi hai brake dabane par"*
- Code-switched — *"Mera Hyundai Creta 2021 diesel ka AC thanda nahi kar raha"*

Plus Whisper's bracketed annotations (`[MUSIC]`, `[BLANK_AUDIO]`), which
`_postprocess` strips — a driver must never be told their car said "[NOISE]" —
and three prompt-injection attempts, because a transcript is untrusted text that
reaches a model prompt.

---

## 4. Case index

| Case | Establishes |
|---|---|
| **VD-E2E-0101** | The page loads and renders |
| **VD-E2E-0102** | No voice button when the browser lacks SpeechRecognition (Firefox, Android WebView) |
| **VD-E2E-0103** | The voice button appears when it is supported |
| **VD-E2E-0201** | **Consent is asked before recognition ever starts** — asserted by counting `start()` calls, not by looking at the screen |
| **VD-E2E-0202** | The consent notice carries a version |
| **VD-E2E-0203** | Declining closes voice mode and never opens the microphone |
| **VD-E2E-0301** | Granting consent offers the Indian languages, Hindi included |
| **VD-E2E-0401** | **A diagnosis reaches the screen from the real knowledge base** — `engine: knowledge_base`, `DX-BRK-001`, and the repair text visible in the DOM |
| **VD-E2E-0402** | A safety-critical answer tells the driver not to drive |
| **VD-E2E-0403** | A spoken transcript reaches the page and drives the conversation |
| **VD-E2E-0404** | A recognition error is surfaced, not swallowed |
| **VD-E2E-0405** | Closing voice mode stops the microphone |
| **VD-E2E-0501** | `/diagnosis/stt` returns 503 when no provider is configured |
| **VD-E2E-0502** | `/diagnosis/tts` returns 503 when no provider is configured |
| **VD-E2E-0601** | The DPDP erasure control is not offered to a signed-out user |

VD-E2E-0403 is the one worth watching run. The spoken sentence appears in the
transcript, the client extracts **✓ Maruti Suzuki ✓ Swift ✓ 2019 ✓ Petrol**, and
the assistant asks the one thing still missing: *"And the transmission type?"*

---

## 5. Findings

### F-01 — "Tap mic to speak" instructs an action the UI does not implement · **Low** · open

`voice-mode.component.ts:218` computes a status label whose idle value is
**"Tap mic to speak"**. The mic it refers to is
`voice-mode.component.html:99` — a `<div class="vm-mic-icon" aria-hidden="true">`
with **no click handler**. There is no `(click)` on the mic or its container.

`voice-diagnosis.service.ts:308` sets state to `idle` on `onend` and does not
restart listening; the component normally restarts it after speaking. So the
label is usually transient. But whenever the speak-then-listen handoff does not
fire, the driver is left looking at an instruction they cannot follow.

**Evidence and its limits.** I reproduced the stuck state, but only with a
speech-synthesis stub that fired `onend` without `onstart`. With real Chromium
synthesis I could not reach it. So: the missing handler is certain; how often a
real user lands there is not established. Either make the mic tappable, or
change the copy to describe what actually happens.

### F-02 — the API required TLS to Postgres and the local instance had none

Not a product defect — `db/session.py` sets `connect_args={"ssl": "require"}`,
which is correct for Supabase. Recording it because it cost time and will cost
it again: a local Postgres without TLS makes every database call fail with
`rejected SSL upgrade`. Fixed by enabling TLS on the test instance rather than
weakening the app.

### F-03 — I broke CI, and the claim that let me do it was wrong

I added the spec to `desktop-chrome`'s `testMatch` believing Playwright never
ran in CI. It does: `.github/workflows/ci-web.yml`, job **"Build & smoke test"**,
installs Chromium and runs `npx playwright test --project=desktop-chrome` on
every change under `apps/gaadiiq-angular/**`. The web job went red — 33 passed,
3 failed — because CI starts no API.

The claim came from `CLAUDE.md` and I repeated it into four documents without
checking it. All five are now corrected.

Worse than the red build: **VD-E2E-0402 passed in CI for the wrong reason.** It
asserted `/not safe to drive|do not drive/i` against the page body, and the
standing disclaimer already reads *"do NOT drive the vehicle until it has been
professionally inspected"* — so it passed with no API and no diagnosis at all. A
test that passes when the feature is absent is worse than no test. It now
asserts `safe_to_drive`, `risk_level` and `immediate_service_required` on the
API response.

### Two harness faults of my own

- **A fake that was close but not faithful.** My `speechSynthesis` stub fired
  `onend` without `onstart`, so `speakingState` never became `speaking`, the
  component's greeting-then-listen handoff never ran, and the session stalled.
  It looked exactly like an app bug for three runs. Removed — Chromium's own
  synthesis has no voices here, makes no sound, and fires the real sequence.
- **Assuming an API's absence.** I wrote the suite believing Chromium had no
  `SpeechRecognition`. It has both spellings. The "unsupported browser" case now
  *deletes* the API to reproduce Firefox, rather than relying on it being absent.

---

## 6. Running it

```bash
# 1. Postgres with TLS, and a database with the migrations applied
alembic upgrade head

# 2. Seed the knowledge base (rows must be ACTIVE + VERIFIED to be served)
python tests/data/…  # see docs/qa/AI_DIAGNOSIS_E2E_TEST_PLAN.md §3

# 3. API
uvicorn main:app --host 127.0.0.1 --port 8000

# 4. Build and serve the app
cd apps/gaadiiq-angular && ng build --configuration development
node e2e/static-server.mjs dist/gaadiiq-angular/browser 4300

# 5. Drive it
PLAYWRIGHT_BASE_URL=http://127.0.0.1:4300 \
PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/chromium \
  npx playwright test e2e/voice-diagnosis.spec.ts --project=desktop-chrome
```

The spec is registered in `playwright.config.ts` under the `desktop-chrome`
project's `testMatch`. That registration is not optional: **a spec named by no
`testMatch` runs nowhere and reports nothing**, which is indistinguishable from
passing.

---

## 7. What this still does not cover

- **Real speech.** No audio is recognised. Accent handling, background noise and
  Indian-language recognition accuracy are untested and cannot be tested here.
- **Real STT/TTS providers.** Both are unconfigured, so 0501 and 0502 assert the
  503 contract. The Whisper, Google and Azure paths in `services/stt.py` have
  never been exercised against a live provider.
- **iOS Safari.** The `mobile-390` project uses WebKit, but this spec is
  registered only for `desktop-chrome`. Safari's speech behaviour differs and is
  the platform the server-side fallback most exists for.
- **Only `desktop-chrome` runs in CI**, and with no API behind it. Eleven of
  the fifteen cases run there; the four needing a backend skip. Nothing checks
  those four except a manual run.
