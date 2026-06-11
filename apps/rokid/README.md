# TARS Rokid — Glasses HUD for TARS

Stream TARS responses token-by-token onto Rokid AR Lite glasses.
Voice-first. Camera input. Green monochrome HUD on an AR waveguide.

```
TARS Harness ──── ws /api/rokid/ws?token=<jwt> ────┐
                                                    │
                                   Android Phone App (phone-app)
                                   TarsClient.kt
                                                    │
                                   Rokid CXR-M SDK (Bluetooth)
                                                    │
                                   Glasses HUD App (glasses-app)
                                   480×640 green micro-LED
```

## How it differs from clawsses

| | clawsses | TARS Rokid |
|---|---|---|
| Backend | OpenClaw Gateway | TARS Harness |
| Auth | Ed25519 device identity + pairing | JWT from TARS login |
| Sessions | OpenClaw sessions | TARS conversations |
| Wire format (phone↔glasses) | Identical | Identical |
| Glasses app | Same | Same (just rebranded) |

The phone↔glasses protocol (`shared/Protocol.kt`) is wire-compatible with
clawsses so the glasses-side code is a straight copy.

## Prerequisites

- Android Studio
- Rokid developer account (CXR SDK credentials — client secret + access key)
- Running TARS harness (local dev or production)
- Rokid AR Lite glasses (or use the emulator — see below)

## Setup

### 1. SDK credentials

Create `local.properties` in this directory:
```properties
rokid.clientSecret=your-client-secret
rokid.accessKey=your-access-key
```

### 2. Wire in the Rokid CXR SDK

Two stubs need real SDK calls:

**phone-app:** `glasses/RokidSdkManager.kt` — `init()`, `send()`, `wakeDisplay()`, `release()`
**glasses-app:** `service/PhoneConnectionService.kt` — `start()`, `send()`, `stop()`
**glasses-app:** `input/GestureHandler.kt` — register touchpad event callbacks

Full Rokid SDK docs are in `../../../docs/rokid-sdk/` and `../../../docs/rokid-sdk-glasses/`
(copy from the clawsses repo: https://github.com/dweddepohl/clawsses/tree/main/docs)

### 3. Build

```bash
./gradlew assembleDebug

# Install phone app
adb install phone-app/build/outputs/apk/debug/phone-app-debug.apk
```

The phone app can push the glasses APK over WiFi P2P — see the Settings screen.

### 4. Configure

1. Open the TARS phone app
2. Enter your TARS server host, port, username, password
3. Tap "Login & Connect" — the app fetches a JWT and saves it
4. The bridge service starts automatically in the background
5. Pair your Rokid glasses via Bluetooth

## Emulator testing (no hardware needed)

Create two AVDs: phone (any) and glasses (480×640, 5" screen).

The phone app in debug mode starts a local WebSocket server on port 8081.
Run the glasses emulator:
```bash
adb -s <glasses-emulator> reverse tcp:8081 tcp:8081
```

The glasses emulator's `DebugPhoneClient` auto-connects to `10.0.2.2:8081`.
Point the phone app at your local TARS harness (`localhost:8000`).

## Architecture notes

- `TarsClient.kt` — replaces clawsses' OpenClawClient. JWT auth, no pairing.
- `TarsBridgeService.kt` — foreground service, keeps both connections alive.
- `HudScreen.kt` — Jetpack Compose UI targeting 480×640 green micro-LED.
- `WakeSignalManager.kt` — wakes display before streaming content arrives.
- Protocol is identical to clawsses phone↔glasses format for compatibility.

## Adding voice (optional)

Voice input is handled on the phone. Long-press the glasses temple → phone
receives `start_voice` and starts speech recognition. To wire it in, add
`VoiceCommandHandler.kt` from clawsses (it sends `UserInput` to TARS via
`TarsClient.sendUserInput()`).

For better STT quality, wire in OpenAI Whisper (same as clawsses `OpenAIRealtimeClient.kt`).

## Adding TTS (optional)

TTS runs on the phone and plays through its speakers. Wire in ElevenLabs
from clawsses `tts/ElevenLabsClient.kt` — it listens for `chat_stream_end`
events and speaks the completed assistant message.
