# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Versioning — MANDATORY

**Every meaningful change to this project must be committed and pushed before reporting it as done.**

### Glasses build tag (`BUILD_TAG`)
- Defined in `BuildConfig.BUILD_TAG`, generated at build time by `glasses-app/build.gradle.kts`
- Derived from `git rev-list --count HEAD` — automatically increments with every commit
- **Never edit `BUILD_TAG` manually.** Just commit your changes and rebuild.
- Shown in the HUD top-right corner so Mike can confirm which build is on the glasses.

### After any glasses-side change:
1. Commit all changes (`git add` + `git commit`)
2. Push to main (`git push origin main`)
3. Run `./gradlew :phone-app:assembleDebug` to produce the updated phone APK (which bundles the new glasses APK)
4. The new `BUILD_TAG` (= `b<commit-count>`) confirms the correct build is running once pushed to the glasses via the phone app's APK installer.

### App versioning (`versionName`)
- `versionName` in `glasses-app/build.gradle.kts` follows `1.0.<buildNumber>`
- For breaking changes, bump the major segment manually in `build.gradle.kts` (e.g. `2.0.$buildNumber`)

### Phone app versioning
- `phone-app/build.gradle.kts` has a separate `versionCode`/`versionName` — bump manually when releasing to production devices.

## Build Commands

```bash
# Build both APKs (glasses APK is bundled into phone APK assets automatically)
./gradlew assembleDebug

# Build only glasses app
./gradlew :glasses-app:assembleDebug

# Build only phone app (triggers glasses build via bundleGlassesApk task)
./gradlew :phone-app:assembleDebug

# Clean build
./gradlew clean assembleDebug
```

The phone app's `preBuild` depends on a `bundleGlassesApk` task that copies `glasses-app-debug.apk` into `phone-app/src/main/assets/glasses-app-release.apk` for sideloading to glasses.

## Architecture

```
TARS Harness  ←WebSocket /api/rokid/ws→  Phone App (Android)  ←Bluetooth/CXR→  Glasses App (Android)
      │                                        │                                        │
 JWT WebSocket                           CXR-M SDK                                CXR-S SDK
 SSE → glasses protocol                  Voice + TTS                              Chat HUD
 proxied by rokid.py                     Bridge logic                             Gesture input
```

Three Gradle modules:
- **shared/** — Protocol data classes (Gson-serialized). Used by both apps.
- **phone-app/** — Companion app. Connects to TARS harness via JWT WebSocket and to glasses via Rokid CXR-M SDK (Bluetooth) or debug WebSocket.
- **glasses-app/** — HUD app running on Rokid glasses. Receives messages from phone via CXR-S SDK bridge. Renders chat UI with Jetpack Compose.

## TARS Connection

The phone app authenticates to TARS with username/password (`POST /api/auth/login` → JWT), then opens a persistent WebSocket at `ws://<host>/api/rokid/ws?token=<jwt>`.

On the harness side, `apps/harness/api/routes/rokid.py` proxies TARS SSE (streaming chat responses) into the glasses wire format and forwards phone→glasses JSON messages back through the WebSocket.

**Auth flow:** Login with TARS credentials → JWT stored in SharedPreferences → JWT attached as query param on WebSocket connect → harness validates JWT on every connection.

## Phone ↔ Glasses Protocol

Defined in `shared/.../Protocol.kt`. JSON messages over CXR SDK (production) or WebSocket (debug).

**Phone → Glasses:** `chat_message`, `agent_thinking`, `chat_stream` (incremental chunk), `chat_stream_end`, `connection_update`, `session_list`, `voice_state`, `voice_result`, `wake_signal`, `hw_photo_key`, `tts_state`

**Glasses → Phone:** `user_input` (text + optional imageBase64), `list_sessions`, `switch_session`, `slash_command`, `start_voice`, `cancel_voice`, `request_more_history`, `wake_ack`, `tts_toggle`, `remove_photo`

## Glasses HUD

480x640 portrait display, JBD 0.13" micro-LED (~6,150 DPI), monochrome green on black. JetBrains Mono font. Font size auto-calculated to fit target column count based on display width.

**Layout:** TopBar (connection + mode indicator + scroll position) → ChatContentArea (LazyColumn) → MenuBar (Session | Size | Font | More)

**Two focus areas** — CONTENT and MENU. No INPUT focus (all input is voice via long-press).

| Area | Swipe Fwd | Swipe Bwd | Tap | Double-tap | Long-press |
|------|-----------|-----------|-----|------------|------------|
| CONTENT | Scroll up | Scroll down (push-through → MENU) | Jump to bottom | → MENU | Voice |
| MENU | Prev item (push-through → CONTENT) | Next item | Execute | → CONTENT | Voice |

**HUD position** cycles via SIZE menu: Full → Bottom Half → Top Half. SIZE icon dynamically shows what the next position will be.

**FONT** changes chat content font size by varying target columns: Compact(70) → Normal(60) → Comfortable(50) → Large(40). Menu bar uses fixed font size.

Voice results auto-submit immediately (no manual text entry).

## Rokid SDK Documentation

Full scraped SDK docs are available locally for reference:

- **CXR-M SDK (Mobile):** `docs/rokid-sdk/` — Bluetooth/WiFi connection, device controls, camera/audio, AI scene, teleprompter, translation, custom views
- **CXR-S SDK (Glasses):** `docs/rokid-sdk-glasses/` — On-device development, message subscription/sending, Caps data structure

Each directory has a `README.md` with an index. These docs were scraped from Rokid's custom documentation portal.

## SDK & Credentials

Rokid CXR SDK handles Bluetooth: `com.rokid.cxr:client-m:1.0.8` (phone), `com.rokid.cxr:cxr-service-bridge:1.0` (glasses). Maven repo: `https://maven.rokid.com/repository/maven-public/`.

Required in `local.properties` (gitignored):
```properties
rokid.clientId=...
rokid.clientSecret=...
rokid.accessKey=...
```

These are injected as `BuildConfig` fields in the phone app. `clientSecret` is used for AES-encrypted SN verification during Bluetooth pairing. The encrypted SN is cached in SharedPreferences after first successful connection to avoid the two-attempt flow on subsequent launches.

## Debug Mode

For emulator testing without physical glasses. Auto-enabled when `BuildConfig.DEBUG && isEmulator()`.

- Phone starts a WebSocket server on port 8081 (toggle in Settings)
- Glasses connects to `10.0.2.2:8081` (emulator host alias)
- Create glasses emulator: 480x640, 5" screen
- Keyboard in emulator: Volume keys = swipe, Enter = tap, Back/Esc = double-tap, any char starts keyboard capture mode

```bash
# Logcat filtering
adb -s emulator-5554 logcat | grep -E "(MainScreen|TarsClient|GlassesConnection|RokidSdkManager)"
adb -s emulator-5556 logcat | grep -E "(GlassesApp|HudActivity|PhoneConnection)"
```

## Key State Patterns

- `MutableStateFlow` for all reactive state (glasses HudState, phone connection states)
- TarsClient uses coroutine-based streaming for TARS SSE message handling
- Callbacks (nullable lambdas) for inter-component message routing
- Sealed classes for connection state machines (`ConnectionState`, `VoiceInputState`)
- Auto-reconnect with 3-second delay on disconnect/error

## File Reference

```
shared/src/main/java/com/clawsses/shared/
└── Protocol.kt                    # All message types + JSON parsing

phone-app/src/main/java/com/clawsses/phone/
├── tars/
│   ├── TarsClient.kt              # JWT WebSocket client → TARS harness /api/rokid/ws
│   └── TarsAuthManager.kt         # Login → JWT, persisted in SharedPreferences
├── glasses/
│   ├── GlassesConnectionManager.kt # BLE scan/connect or debug WebSocket
│   ├── RokidSdkManager.kt         # CXR-M SDK, SN verification, persistence
│   └── ApkInstaller.kt            # Push glasses APK via WiFi P2P
├── ui/screens/MainScreen.kt       # Main UI, component wiring, settings
├── voice/VoiceCommandHandler.kt   # Speech recognition
├── service/GlassesConnectionService.kt  # Foreground service
└── debug/DebugGlassesServer.kt    # WebSocket server for emulator

glasses-app/src/main/java/com/clawsses/glasses/
├── HudActivity.kt                 # Gesture routing, message handling, state
├── ui/
│   └── HudScreen.kt               # Compose HUD (chat, menus, overlays)
├── input/GestureHandler.kt        # Touchpad gesture detection
├── voice/GlassesVoiceHandler.kt   # Voice delegation to phone
├── service/PhoneConnectionService.kt  # CXR-S bridge
└── debug/DebugPhoneClient.kt      # WebSocket client for emulator
```
