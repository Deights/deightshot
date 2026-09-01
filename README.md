# DeightShot

*[Türkçe](README.tr.md)*

**A screenshot tool for Windows.** It does what Lightshot does, and then makes
the text on your screen **selectable** (OCR), hides things with **pixelate /
blur**, and grabs the whole screen when you **hold** the key.

Fully offline by default — **zero telemetry**.

---

## What it does

| | |
|---|---|
| **Region select** | Drag · resize from edges · move from inside · 1 px nudge with arrow keys |
| **Annotate** | Pen · arrow · line · box · ellipse · highlighter · text · **pixelate** · undo |
| **Text selection (OCR)** | Double-click → on-screen text becomes **selectable text**, `Ctrl+C` copies it |
| **Hold = fullscreen** | Tap `Ins` → region select. Hold it 700 ms → full screen |
| **Multi-monitor** | One overlay per display, DIP↔physical pixel conversion |
| **Translation** | Translates selected text as inline subtitles (pluggable engine) |

The hotkey is **swallowed** — pressing `Ins` no longer toggles overtype mode in
whatever editor happens to be focused.

## Privacy

**Zero telemetry.** The app makes no network requests on its own.

The only exception: when the user **explicitly enables** the remote translation
engine in Settings and enters their own API key. While it is off, screen text
never leaves the machine — not even as a fallback when the local engine
(Ollama) is unavailable. It reports an error instead of sending anything out.

## Requirements

- Windows 10 20H2+ / Windows 11 (for Windows Graphics Capture and Windows.Media.Ocr)
- Node.js 18+
- .NET SDK 10 (only to build the native helper)

Additional OCR languages come from Windows' own language packs. Tesseract is
not used.

## Running from source

```bash
npm install
npm run native:build     # the C# helper process
npm start
```

> ⚠️ A VS Code terminal may define `ELECTRON_RUN_AS_NODE=1`. With that variable
> set, Electron thinks it is plain Node and `require('electron')` returns a file
> path instead of the API. Clear it before starting.

## Packaging

```bash
npm run native:publish   # self-contained C# helper -> dist-native/
npm run paket            # -> dist/deightshot-kurulum-<version>.exe
```

The installer is unsigned, so Windows Smart App Control may block it if enabled.
A portable build that needs no installation:

```bash
npm run paket:dizin      # -> dist/win-unpacked/
```

Copy that folder anywhere and run `DeightShot.exe` — no install, no admin
rights required.

> ⚠️ **Unsigned binaries and Smart App Control.** Measured, not assumed: Smart
> App Control blocks both the installer *and* the portable executable. It is not
> about how the app is delivered, it is about the missing signature. SAC is only
> on by default on clean Windows 11 installs; machines upgraded from Windows 10
> generally have it off.

## Architecture

```
Electron (UI, overlay, drawing)
   │  line-delimited JSON over stdin/stdout
   ▼
deightshot-native.exe  (C# / .NET)
   ├─ Windows Graphics Capture   capture (not BitBlt — works in games too)
   ├─ Windows.Media.Ocr          text recognition, offline
   └─ WH_KEYBOARD_LL             hotkey; swallows the key
```

A separate process was chosen because both APIs are first-class in C#: NodeRT is
unmaintained, and a C++ addon would mean recompiling for every Electron release.
The separate process also keeps the UI from ever blocking.

The core (capture / overlay / drawing) lives in `src/main/`; capabilities added
later live in `modules/<name>/` as plugins.

## Repository layout

```
src/main/      core: capture, overlay, hotkey, tray, settings
src/ui/        UI: overlay and settings window (HTML/CSS/JS)
src/preload/   bridge between renderer and main process
modules/       plugins — OCR text selection, translation (see modules/README.md)
native/        C# helper process: WGC capture, OCR, keyboard hook
assets/        tray icons and app icon (generated from assets/logo-kaynak.png)
tools/         development and measurement tools — NOT part of the product
spike/         throwaway code written to validate the architecture, kept as reference
```

`tools/` and `spike/` are not needed to run the app. They are in the repository
because most of them are the evidence behind a decision: whether to use WGC or
BitBlt, which OCR upscale factor actually helps, why the hotkey is captured with
a native hook — each was settled by a measurement that lives here.

⛔ `tools/gorsel-test.js` **captures the real screen and injects synthetic
keystrokes.** Do not run it out of curiosity; details in `tools/README.md`.

> Note: the source comments and the tool scripts are written in Turkish.

## Status

In daily use. Known gaps:

- No history of recently captured images
- Subtitles are not baked into the copied/saved image (separate DOM layer)
- Pressing `Ins` again while the overlay is open has no defined behaviour
- Overlapping highlighter strokes darken each other

## License

**No license.** The source is visible, but no permission is granted to use,
modify or distribute it; all rights reserved. This is deliberate — a license can
be added later, it cannot be taken back.
