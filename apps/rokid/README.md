# Clawsses

Wearable TARS interface for [Rokid AR Lite glasses](https://global.rokid.com/pages/rokid-glasses). Streams TARS responses token-by-token onto the glasses HUD, with voice input, photo capture, and session management — all from the glasses temple touchpad.

## Architecture

```
TARS Harness ──── ws /api/rokid/ws ──── Phone App (Android) ──── Bluetooth CXR ──── Glasses App (Rokid)
      │                                        │                                            │
 JWT WebSocket                          CXR-M SDK bridge                            480×640 green HUD
 SSE → glasses                          Voice + TTS                                 Jetpack Compose
 protocol proxy                         Wake management                             Temple gestures
```

Three Gradle modules:

| Module | Description |
|--------|-------------|
| **shared/** | Protocol data classes (Gson-serialized). Used by both apps. |
| **phone-app/** | Android companion app. Connects to TARS harness via JWT WebSocket and to glasses via Rokid CXR-M SDK over Bluetooth. Handles voice recognition, TTS playback, and wake coordination. |
| **glasses-app/** | HUD app running on Rokid AR Lite. Renders chat UI with Jetpack Compose on the 480×640 monochrome green micro-LED display. Handles touchpad gestures and camera capture. |

## Setup

### Prerequisites

- Android Studio
- Rokid AR Lite (or emulator — see [Emulator Testing](#emulator-testing))
- Rokid developer account for CXR SDK credentials
- TARS harness running and accessible (local or via VPN)

### 1. SDK Credentials

Create `local.properties` in the project root:

```properties
rokid.clientId=your-client-id
rokid.clientSecret=your-client-secret
rokid.accessKey=your-access-key
rokid.maven.username=your@email.com
rokid.maven.password=yourpassword
```

These are injected as `BuildConfig` fields at compile time and required for Bluetooth pairing with the glasses.

### 2. TARS Connection

In the phone app Settings, configure:
- **Host** — TARS harness URL (e.g. `ws://tarsmv.duckdns.org` or `ws://192.168.1.x:8000`)
- **Username / Password** — same credentials used to log into TARS web

The phone app authenticates via JWT (`/api/auth/login`), then opens a persistent WebSocket at `/api/rokid/ws?token=<jwt>`. The harness proxies TARS SSE responses into the glasses wire format in real time.

### 3. Build & Install

```bash
# Build both APKs (glasses APK is bundled into phone APK assets automatically)
./gradlew assembleDebug

# Install phone app
adb install phone-app/build/outputs/apk/debug/phone-app-debug.apk
```

The phone app bundles the glasses APK and can push it to the glasses over WiFi — no developer cable needed for glasses-side installs.

### 4. Connect

1. Open the phone app and configure TARS host + credentials in Settings
2. Fold the right leg and triple-click the camera button to start Bluetooth pairing on the glasses
3. Scan for and pair with the glasses from the phone app
4. Use **Install to glasses** in Settings to sideload the glasses APK
5. Open the Clawsses app from the glasses launcher

## Usage

### Voice Input

Long-press the glasses temple to start voice recognition. Short-press the physical AI/camera button to take a photo.

| Press | Action |
|-------|--------|
| Short press (< 200ms) | Capture photo |
| Long press (≥ 200ms) | Start voice recognition |

### Temple Touchpad Gestures

| Gesture | Content area | Menu bar |
|---------|-------------|----------|
| Swipe → (toward eyes) | Scroll down | Previous item |
| Swipe ← (toward ear) | Scroll up | Next item |
| Tap | Jump to bottom | Execute action |
| Double-tap | Focus menu bar | Exit menu / back |
| Long-press | Voice input | Voice input |

### Menu Bar

| Item | Action |
|------|--------|
| 📷 PHOTO | Capture photo (up to 4) to attach to next voice message |
| ◎ SESSION | Browse and switch TARS conversations |
| █ SIZE | Cycle HUD position: Full → Bottom Half → Top Half |
| … MORE | Font size, delete staged photos, slash commands, voice toggle |

### MORE Menu Options

| Option | Action |
|--------|--------|
| Font sizes | Compact / Normal / Comfortable / Large |
| ⌫ Del Photos | Clear all staged photos from the current session |
| /commands | Quick access to slash commands |
| Voice toggle | Enable/disable TTS for responses |

## Display

The Rokid AR Lite uses JBD 0.13" micro-LED displays:
- **Resolution:** 480×640 (portrait)
- **Color:** Monochrome green on transparent AR waveguide
- **Font:** JetBrains Mono
- **Font sizes:** Compact / Normal / Comfortable / Large

## Emulator Testing

Debug mode runs without physical glasses or SDK credentials.

1. Create a glasses AVD: 480×640, 5" screen
2. Run phone emulator — it starts a local WebSocket server on port 8081
3. Run glasses emulator — it auto-connects to `10.0.2.2:8081`

```bash
./gradlew :phone-app:installDebug
./gradlew :glasses-app:installDebug
```

Keyboard shortcuts in the glasses emulator: Volume keys = swipe, Enter = tap, Back/Esc = double-tap.

## Phone ↔ Glasses Protocol

Defined in `shared/.../Protocol.kt`. JSON over CXR SDK (production) or WebSocket (debug).

**Phone → Glasses:** `chat_message`, `agent_thinking`, `chat_stream`, `chat_stream_end`, `connection_update`, `session_list`, `voice_state`, `voice_result`, `wake_signal`, `hw_photo_key`, `tts_state`

**Glasses → Phone:** `user_input` (text + optional imageBase64), `list_sessions`, `switch_session`, `slash_command`, `start_voice`, `cancel_voice`, `request_more_history`, `wake_ack`, `tts_toggle`, `remove_photo`

## Troubleshooting

**Can't connect to TARS**
- Check host/port in Settings — make sure TARS harness is running
- For remote access, use a VPN (Tailscale works well)
- Verify the `/api/rokid/ws` route is enabled in the harness

**Glasses app won't install**
- Unpair + re-pair Bluetooth, then retry from Settings → Install to glasses
- Try a clean build: `./gradlew clean assembleDebug`

**Voice not working**
- Confirm microphone permission is granted to the phone app
- Check the harness is reachable — voice transcription goes through TARS

**Build fails**
- Ensure `local.properties` exists with valid Rokid SDK credentials
- First build pulls from Rokid Maven — internet access required
