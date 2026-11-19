# STRIDE

<p align="center">
  <strong><a href="https://ag-thecoderr.github.io/fpp/">▶ Play in the browser</a></strong><br/>
  <sub>https://ag-thecoderr.github.io/fpp/</sub>
</p>

<p align="center">
  <a href="https://ag-thecoderr.github.io/fpp/">
    <img src="public/readme-hero.jpg" alt="STRIDE — first person on a white rooftop, red paint, glass city" width="100%" />
  </a>
</p>

First-person rooftop parkour. White city, red things you can grab, a web that actually swings. Time the line. Don’t eat pavement.

**Play:** [ag-thecoderr.github.io/fpp](https://ag-thecoderr.github.io/fpp/)

---

## What you do

Run the roofs. Vault, slide, wall-kick, mantle. Hook a lip **above** you and pendulum — W reels in, S pays out, let go at the top of the arc.

32 courses (tutorial through generated lanes). Ghost of your PB. Times live **on this device only**, not in the GitHub files.

## Keys

| | |
|---|---|
| Move | `W A S D` |
| Jump / wall-kick | `Space` |
| Slide | `Shift` / `C` |
| Hook | `RMB` / `LMB` / `E` |
| Restart / last CP | `R` / `F` |
| Pause | `Esc` |

Phone: left half stick, right look, fat JUMP. Settings has sliders if your thumbs don’t reach.

## Run locally

```bash
npm i
npm run dev
```

```bash
npm run build
```

Vite + Three.js. Static host on GitHub Pages.

If the live game looks stuck on an old build, hard-refresh once (the PWA used to cache the JS).
