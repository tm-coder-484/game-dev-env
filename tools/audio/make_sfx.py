"""Build Hollowvale's sound effects into godot/game/audio/.

    make sfx     # = blender -b --factory-startup -P tools/audio/make_sfx.py   (needs numpy; Blender ships it)

1. Picks recorded CC0 sounds from Kenney's "RPG Audio" and "Impact Sounds" packs (downloaded once
   into build/cache/kenney) and copies them under the names the game plays.
2. Synthesises everything the packs don't have with numpy: whooshes, bow twang, splashes, fire,
   creature voices (wolves, Hollows) and looping ambience (wind, surf, crickets, birds).
Variants are <name>.wav/.ogg, <name>_2..., picked at random by game/systems/sfx.gd.
"""
import math
import os
import shutil
import subprocess
import sys
import urllib.request
import wave
import zipfile

import numpy as np

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT = os.path.join(ROOT, "godot", "game", "audio")
CACHE = os.path.join(ROOT, "build", "cache", "kenney")
SR = 44100
rng = np.random.default_rng(3)

PACKS = {
    "rpg": "https://kenney.nl/media/pages/assets/rpg-audio/8e99002d76-1677590336/kenney_rpg-audio.zip",
    "impact": "https://kenney.nl/media/pages/assets/impact-sounds/87b4ddecda-1677589768/kenney_impact-sounds.zip",
}
# game name -> list of files inside the packs
KENNEY = {
    "step_grass": ["footstep_grass_000", "footstep_grass_001", "footstep_grass_002", "footstep_grass_003", "footstep_grass_004"],
    "step_leaves": ["footstep00", "footstep01", "footstep02", "footstep03", "footstep04"],
    "step_rock": ["footstep_concrete_000", "footstep_concrete_001", "footstep_concrete_002", "footstep_concrete_003"],
    "step_sand": ["footstep_snow_000", "footstep_snow_001", "footstep_snow_002", "footstep_snow_003"],
    "chop": ["chop", "impactWood_heavy_000", "impactWood_heavy_001", "impactWood_heavy_002"],
    "mine": ["impactMining_000", "impactMining_001", "impactMining_002", "impactMining_003"],
    "thud": ["impactSoft_medium_000", "impactSoft_medium_001"],
    "hit_flesh": ["impactPunch_heavy_000", "impactPunch_heavy_001", "impactPunch_heavy_002"],
    "hurt": ["impactPunch_medium_000", "impactPunch_medium_001"],
    "block": ["impactWood_medium_000", "impactWood_medium_001"],
    "arrow_thunk": ["impactWood_light_000", "impactWood_light_001", "impactWood_light_002"],
    "land": ["impactSoft_heavy_000", "impactSoft_heavy_001"],
    "death": ["impactSoft_heavy_002"],
    "pickup": ["handleSmallLeather", "handleSmallLeather2"],
    "craft": ["clothBelt", "clothBelt2", "beltHandle1"],
    "bandage": ["cloth1", "cloth2"],
    "jump": ["cloth3", "cloth4"],
    "bush": ["cloth2", "cloth4"],
    "grass": ["cloth1", "cloth3"],
    "harvest": ["knifeSlice", "knifeSlice2"],
    "draw": ["creak1", "creak3"],
}


def fetch_packs():
    os.makedirs(CACHE, exist_ok=True)
    found = {}
    for key, url in PACKS.items():
        z = os.path.join(CACHE, key + ".zip")
        if not os.path.exists(z):
            req = urllib.request.Request(url, headers={"User-Agent": "game-dev-env/1.0"})
            with urllib.request.urlopen(req, timeout=120) as r, open(z, "wb") as f:
                f.write(r.read())
        zf = zipfile.ZipFile(z)
        for n in zf.namelist():
            if n.endswith(".ogg"):
                found[os.path.basename(n)[:-4]] = (zf, n)
            if n.endswith("License.txt"):
                found["_license_" + key] = (zf, n)
    return found


def copy_kenney(found):
    for name, files in KENNEY.items():
        for i, f in enumerate(files):
            zf, n = found[f]
            dst = os.path.join(OUT, name + ("" if i == 0 else f"_{i + 1}") + ".ogg")
            with zf.open(n) as src, open(dst, "wb") as out:
                shutil.copyfileobj(src, out)
    zf, n = found["_license_rpg"]
    with zf.open(n) as src, open(os.path.join(OUT, "LICENSE-kenney.txt"), "wb") as out:
        out.write(b"Recorded sounds (*.ogg) from Kenney's RPG Audio and Impact Sounds packs, www.kenney.nl\n\n")
        shutil.copyfileobj(src, out)


# ------------------------------------------------------------------ DSP ----
def t(sec):
    return np.arange(int(sec * SR)) / SR


def noise(sec):
    return rng.standard_normal(int(sec * SR))


def brown(sec):
    x = np.cumsum(noise(sec))
    x -= np.convolve(x, np.ones(2000) / 2000, mode="same")
    return x / (np.abs(x).max() + 1e-9)


def lowpass(x, cutoff):
    """One-pole low-pass; cutoff may be a per-sample array."""
    c = np.broadcast_to(np.asarray(cutoff, dtype=float), x.shape)
    a = 1.0 - np.exp(-2.0 * np.pi * c / SR)
    y = np.empty_like(x)
    acc = 0.0
    for i in range(len(x)):
        acc += a[i] * (x[i] - acc)
        y[i] = acc
    return y


def highpass(x, cutoff):
    return x - lowpass(x, cutoff)


def bandpass(x, center, q=2.0):
    """State-variable band-pass; center may be a per-sample array."""
    c = np.broadcast_to(np.asarray(center, dtype=float), x.shape)
    f = 2.0 * np.sin(np.pi * np.clip(c, 20, SR / 6) / SR)
    damp = 1.0 / q
    low = band = 0.0
    y = np.empty_like(x)
    for i in range(len(x)):
        high = x[i] - low - damp * band
        band += f[i] * high
        low += f[i] * band
        y[i] = band
    return y


def env(n, attack, release, curve=2.0):
    e = np.ones(n)
    a = min(int(attack * SR), n)
    r = min(int(release * SR), n)
    if a:
        e[:a] = np.linspace(0, 1, a) ** 0.5
    if r:
        e[-r:] *= np.linspace(1, 0, r) ** curve
    return e


def reverb(x, wet=0.3, size=1.0):
    out = np.concatenate([x, np.zeros(int(SR * 1.2 * size))])
    acc = np.zeros_like(out)
    for d, g in ((1557, 0.8), (1617, 0.79), (1491, 0.78), (1422, 0.77)):
        d = int(d * size)
        y = out.copy()
        for i in range(d, len(y)):
            y[i] += g * y[i - d]
        acc += y
    acc /= 4.0
    return out * (1 - wet) + acc / (np.abs(acc).max() + 1e-9) * np.abs(out).max() * wet * 2.0


def saw(freq, sec, phase=0.0):
    ph = np.cumsum(np.broadcast_to(np.asarray(freq, dtype=float), (int(sec * SR),)) / SR) + phase
    return 2.0 * (ph % 1.0) - 1.0


def sine(freq, sec):
    ph = np.cumsum(np.broadcast_to(np.asarray(freq, dtype=float), (int(sec * SR),)) / SR)
    return np.sin(2 * np.pi * ph)


def write(name, x, peak=0.85):
    x = np.asarray(x, dtype=float)
    x = x / (np.abs(x).max() + 1e-9) * peak
    fade = min(len(x), 256)
    x[-fade:] *= np.linspace(1, 0, fade)
    data = (x * 32767).astype("<i2").tobytes()
    with wave.open(os.path.join(OUT, name + ".wav"), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(data)


def loopable(x, xfade=1.0):
    """Crossfade the tail into the head so the sound loops without a click."""
    n = int(xfade * SR)
    head = x[:n].copy()
    tail = x[-n:]
    w = np.linspace(0, 1, n)
    x = x[:-n].copy()
    x[:n] = tail * (1 - w) + head * w
    return x


# ------------------------------------------------------------ sounds ----
def whoosh(sec=0.28, lo=500, hi=2600):
    n = int(sec * SR)
    k = np.linspace(0, 1, n)
    sweep = lo + (hi - lo) * np.sin(np.pi * k) ** 2
    return bandpass(noise(sec), sweep, 1.2) * np.sin(np.pi * k) ** 1.5


def bow_twang():
    n = int(0.7 * SR)
    period = int(SR / 118)
    buf = rng.uniform(-1, 1, period)
    y = np.empty(n)
    for i in range(n):
        y[i] = buf[i % period]
        buf[i % period] = 0.5 * (buf[i % period] + buf[(i + 1) % period]) * 0.996
    thwack = lowpass(noise(0.7), 900) * env(n, 0.001, 0.68, 6)
    return y * 0.8 + thwack * 0.5 + whoosh(0.7, 300, 1800) * 0.25


def splash(sec=0.6):
    n = int(sec * SR)
    x = lowpass(noise(sec), np.linspace(4000, 600, n)) * env(n, 0.005, sec * 0.9, 2.5)
    for _ in range(6):
        s = int(rng.uniform(0.05, sec * 0.8) * SR)
        f0 = rng.uniform(600, 1400)
        b = sine(np.linspace(f0, f0 * 1.8, int(0.04 * SR)), 0.04) * np.linspace(1, 0, int(0.04 * SR))
        x[s:s + len(b)] += b * 0.3
    return x


def drink():
    parts = []
    for i in range(2):
        g = sine(np.linspace(340, 150, int(0.12 * SR)), 0.12) * env(int(0.12 * SR), 0.01, 0.08)
        parts += [g + lowpass(noise(0.12), 800) * 0.2 * env(int(0.12 * SR), 0.005, 0.1), np.zeros(int(0.12 * SR))]
    return np.concatenate(parts)


def crunch():
    x = np.zeros(int(0.9 * SR))
    for i in range(4):
        s = int((0.05 + i * 0.2 + rng.uniform(0, 0.04)) * SR)
        b = highpass(noise(0.09), 1200) * env(int(0.09 * SR), 0.002, 0.08, 3) * rng.uniform(0.6, 1)
        x[s:s + len(b)] += b
    return x


def crackles(sec, rate=18.0, loud=1.0):
    n = int(sec * SR)
    x = np.zeros(n)
    count = int(sec * rate)
    for _ in range(count):
        s = rng.integers(0, n - 2000)
        ln = rng.integers(60, 900)
        pop = rng.standard_normal(ln) * np.exp(-np.arange(ln) / (ln / 5)) * rng.uniform(0.2, 1.0) * loud
        x[s:s + ln] += pop
    return highpass(x, 700)


def fire_loop():
    sec = 7.0
    rumble = lowpass(brown(sec), 250) * 0.5
    hiss = highpass(noise(sec), 3000) * 0.04
    return loopable(rumble + hiss + crackles(sec, 14.0), 1.0)


def growl(sec=1.3, base=95, bright=520, fry=32):
    n = int(sec * SR)
    k = np.linspace(0, 1, n)
    f = base * (1 + 0.08 * np.sin(2 * np.pi * 1.7 * k * sec))
    src = saw(f, sec) + noise(sec) * 0.6
    am = 0.55 + 0.45 * np.sin(2 * np.pi * fry * t(sec) + rng.uniform(0, 6))
    x = bandpass(src * am, bright, 3.0) + bandpass(src * am, bright * 2.3, 4.0) * 0.5 + lowpass(src, 200) * 0.4
    return x * env(n, 0.15, 0.4) * (0.7 + 0.3 * np.sin(np.pi * k))


def yelp():
    sec = 0.32
    n = int(sec * SR)
    k = np.linspace(0, 1, n)
    f = np.interp(k, [0, 0.25, 1], [700, 1150, 520])
    x = sine(f, sec) + 0.5 * sine(f * 2, sec) + 0.25 * sine(f * 3, sec) + bandpass(noise(sec), f * 1.5, 2) * 0.4
    return x * env(n, 0.01, 0.2)


def howl():
    sec = 3.4
    n = int(sec * SR)
    k = np.linspace(0, 1, n)
    f = np.interp(k, [0, 0.15, 0.7, 1], [380, 640, 600, 430]) * (1 + 0.012 * np.sin(2 * np.pi * 5.5 * t(sec)))
    x = sine(f, sec) + 0.3 * sine(f * 2, sec) + 0.1 * sine(f * 3, sec) + bandpass(noise(sec), f, 4) * 0.25
    return reverb(x * env(n, 0.3, 0.8), 0.5, 1.4)


def shriek(sec=1.2, f0=620, f1=980):
    n = int(sec * SR)
    k = np.linspace(0, 1, n)
    f = np.interp(k, [0, 0.3, 1], [f0, f1, f0 * 0.8]) * (1 + 0.03 * np.sin(2 * np.pi * 9 * t(sec)))
    x = sum(saw(f * d, sec, rng.uniform()) for d in (1.0, 1.013, 0.987, 1.5, 2.02)) / 5
    x = x * sine(f * 0.51, sec) * 0.7 + x * 0.3
    x = bandpass(x, f * 1.8, 1.5) + highpass(noise(sec), 2500) * 0.25
    return reverb(x * env(n, 0.03, 0.4), 0.3)


def moan():
    sec = 2.8
    n = int(sec * SR)
    k = np.linspace(0, 1, n)
    f = 92 * (1 + 0.04 * np.sin(2 * np.pi * 0.7 * t(sec)))
    src = sum(saw(f * d, sec, rng.uniform()) for d in (1.0, 1.02, 0.985, 2.01))
    formant = np.interp(k, [0, 0.5, 1], [350, 800, 420])
    x = bandpass(src, formant, 5.0) + bandpass(src, formant * 2.6, 6.0) * 0.4 + bandpass(noise(sec), formant, 3) * 0.3
    return reverb(x * env(n, 0.5, 1.0), 0.45, 1.3)


def tree_fall():
    sec = 3.2
    n = int(sec * SR)
    creak_len = int(1.3 * SR)
    ck = np.linspace(0, 1, creak_len)
    creak = bandpass(saw(np.interp(ck, [0, 1], [38, 24]) * (1 + 0.3 * rng.standard_normal(creak_len) * 0.02), 1.3), 900, 8)
    creak *= env(creak_len, 0.2, 0.3) * (0.5 + 0.5 * np.abs(np.sin(2 * np.pi * 3 * ck)))
    x = np.zeros(n)
    x[:creak_len] += creak
    s = int(1.35 * SR)
    whoo = whoosh(0.5, 200, 900)
    x[s - len(whoo) // 2:s - len(whoo) // 2 + len(whoo)] += whoo * 0.6
    boom_len = n - s
    bt = np.arange(boom_len) / SR
    boom = (np.sin(2 * np.pi * 48 * bt) * np.exp(-bt * 5) + lowpass(rng.standard_normal(boom_len), 500) * np.exp(-bt * 7) * 0.8)
    rustle = highpass(rng.standard_normal(boom_len), 1500) * np.exp(-bt * 2.5) * 0.35
    x[s:] += boom + rustle
    return x


def wind_loop():
    sec = 12.0
    n = int(sec * SR)
    gust = 0.55 + 0.45 * np.sin(2 * np.pi * t(sec) / 6.0) * np.sin(2 * np.pi * t(sec) / 4.0 + 1.0)
    x = lowpass(brown(sec), 900) * 0.6 + bandpass(noise(sec), 500 + 400 * gust, 1.5) * 0.35
    return loopable(x * gust, 2.0)


def surf_loop():
    sec = 12.0
    k = t(sec)
    swell = np.clip(np.sin(2 * np.pi * k / 6.0), 0, 1) ** 1.5
    x = lowpass(noise(sec), 300 + 2500 * swell) * (0.25 + swell) + lowpass(brown(sec), 150) * 0.4
    return loopable(x, 2.0)


def crickets_loop():
    sec = 8.0
    n = int(sec * SR)
    x = np.zeros(n)
    for c in range(3):
        f = rng.uniform(4200, 5200)
        period = rng.uniform(0.45, 0.8)
        s = rng.uniform(0, period)
        while s < sec - 0.2:
            for p in range(3):
                i = int((s + p * 0.03) * SR)
                ln = int(0.018 * SR)
                if i + ln < n:
                    x[i:i + ln] += np.sin(2 * np.pi * f * np.arange(ln) / SR) * np.hanning(ln) * rng.uniform(0.4, 1)
            s += period * rng.uniform(0.9, 1.1)
    return loopable(x + lowpass(brown(sec), 200) * 0.05, 1.0)


def birds_loop():
    sec = 14.0
    n = int(sec * SR)
    x = np.zeros(n)
    s = 0.4
    while s < sec - 1.0:
        f0 = rng.uniform(2200, 4200)
        for p in range(rng.integers(2, 6)):
            ln = int(rng.uniform(0.05, 0.14) * SR)
            k = np.linspace(0, 1, ln)
            f = f0 * (1 + rng.uniform(-0.3, 0.4) * k)
            i = int((s + p * rng.uniform(0.09, 0.16)) * SR)
            if i + ln < n:
                x[i:i + ln] += np.sin(2 * np.pi * np.cumsum(f) / SR) * np.hanning(ln) * rng.uniform(0.3, 1)
        s += rng.uniform(0.8, 2.6)
    return loopable(reverb(x, 0.25)[:n], 1.0)


def main():
    os.makedirs(OUT, exist_ok=True)
    found = fetch_packs()
    copy_kenney(found)
    for i in range(3):
        write("swing" + ("" if i == 0 else f"_{i + 1}"), whoosh(rng.uniform(0.22, 0.3), rng.uniform(400, 600), rng.uniform(2000, 3000)), 0.6)
    write("bow", bow_twang())
    write("swim", splash(0.5), 0.5)
    write("swim_2", splash(0.7), 0.5)
    write("step_water", splash(0.3), 0.4)
    write("drink", drink(), 0.6)
    write("eat", crunch(), 0.6)
    write("sizzle", highpass(noise(1.3), 2500) * env(int(1.3 * SR), 0.05, 0.6) * 0.4 + crackles(1.3, 30, 0.6), 0.6)
    write("fire", fire_loop(), 0.7)
    write("fire_start", np.concatenate([whoosh(0.45, 150, 700) * 0.8, np.zeros(1)]) + np.pad(crackles(0.45, 40), (0, 1)), 0.7)
    write("tree_fall", tree_fall(), 0.9)
    write("tired", bandpass(noise(0.6), 900, 1.0) * env(int(0.6 * SR), 0.1, 0.4), 0.35)
    for i in range(2):
        write("wolf_growl" + ("" if i == 0 else "_2"), growl(rng.uniform(1.1, 1.6), rng.uniform(85, 110)), 0.8)
    write("wolf_snarl", growl(0.6, 150, 1100, 45), 0.8)
    write("wolf_yelp", yelp(), 0.8)
    write("wolf_howl", howl(), 0.8)
    write("hollow_shriek", shriek(1.3, 600, 1050), 0.8)
    write("hollow_attack", shriek(0.55, 700, 1300), 0.8)
    write("hollow_hurt", shriek(0.3, 900, 700), 0.7)
    write("hollow_death", np.concatenate([shriek(1.4, 900, 400), crackles(1.2, 50)]), 0.8)
    write("hollow_moan", moan(), 0.7)
    write("hollow_moan_2", moan(), 0.7)
    write("amb_wind", wind_loop(), 0.6)
    write("amb_surf", surf_loop(), 0.6)
    write("amb_crickets", crickets_loop(), 0.5)
    write("amb_birds", birds_loop(), 0.5)
    # Ogg Vorbis is ~10x smaller than WAV; Godot plays both.
    if shutil.which("ffmpeg"):
        for f in sorted(os.listdir(OUT)):
            if f.endswith(".wav"):
                src = os.path.join(OUT, f)
                subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", src, "-c:a", "libvorbis", "-q:a", "5",
                                src[:-4] + ".ogg"], check=True)
                os.remove(src)
    print(f"wrote sounds to {OUT}")


main()
