from pathlib import Path
from textwrap import dedent
from math import sin, cos, pi

from PIL import Image, ImageDraw, ImageFilter


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public" / "generated"


def write_svg(name: str, svg: str) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / name).write_text(dedent(svg).strip() + "\n", encoding="utf-8")


def hex_to_rgb(value: str) -> tuple[int, int, int]:
    value = value.lstrip("#")
    return tuple(int(value[i : i + 2], 16) for i in (0, 2, 4))


def mix(a: tuple[int, int, int], b: tuple[int, int, int], t: float) -> tuple[int, int, int]:
    return tuple(round(a[i] * (1 - t) + b[i] * t) for i in range(3))


def generate_competition_cover(
    name: str,
    colors: tuple[str, str, str],
    accent: str,
    glow: str,
) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    width, height = 800, 450
    top = hex_to_rgb(colors[0])
    mid = hex_to_rgb(colors[1])
    bottom = hex_to_rgb(colors[2])
    accent_rgb = hex_to_rgb(accent)
    glow_rgb = hex_to_rgb(glow)

    image = Image.new("RGB", (width, height), top)
    pixels = image.load()
    for y in range(height):
        t = y / (height - 1)
        color = mix(top, mid, min(t * 1.4, 1)) if t < 0.72 else mix(mid, bottom, (t - 0.72) / 0.28)
        for x in range(width):
            side_light = int(22 * sin((x / width) * pi) * (1 - t * 0.45))
            pixels[x, y] = tuple(max(0, min(255, c + side_light)) for c in color)

    overlay = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)

    for i in range(9):
        alpha = max(18, 70 - i * 6)
        draw.ellipse(
            (210 + i * 12, -130 + i * 7, 780 + i * 8, 360 + i * 12),
            outline=(*glow_rgb, alpha),
            width=2,
        )

    court_y = 292
    court_color = (220, 244, 255, 82)
    draw.polygon([(0, height), (140, court_y), (660, court_y), (width, height)], fill=(8, 112, 156, 90))
    draw.line([(82, height - 4), (245, court_y), (555, court_y), (718, height - 4)], fill=court_color, width=3)
    draw.line([(190, height), (314, court_y), (314, height)], fill=court_color, width=2)
    draw.line([(400, height), (400, court_y)], fill=court_color, width=2)
    draw.line([(610, height), (486, court_y), (486, height)], fill=court_color, width=2)
    draw.line([(0, 372), (800, 372)], fill=(255, 255, 255, 42), width=2)
    draw.line([(75, 328), (725, 328)], fill=(255, 255, 255, 50), width=2)
    draw.line([(260, court_y), (540, court_y)], fill=(255, 255, 255, 70), width=2)

    trail_layer = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    trail = ImageDraw.Draw(trail_layer)
    for offset, alpha, line_width, color in [
        (0, 210, 11, glow_rgb),
        (24, 150, 7, accent_rgb),
        (-24, 90, 4, (245, 252, 255)),
    ]:
        points = []
        for x in range(150, 690, 16):
            y = 250 - 0.34 * (x - 150) + 26 * sin((x + offset) / 72)
            points.append((x, y + offset * 0.28))
        trail.line(points, fill=(*color, alpha), width=line_width, joint="curve")
    trail_layer = trail_layer.filter(ImageFilter.GaussianBlur(1.4))
    overlay.alpha_composite(trail_layer)

    shuttle_x, shuttle_y = 560, 126
    angle = -18 * pi / 180
    for idx in range(5):
        x1 = shuttle_x + idx * 24
        y1 = shuttle_y + idx * 8
        x2 = shuttle_x + 110 + idx * 11
        y2 = shuttle_y - 58 + idx * 7
        draw.polygon(
            [(x1, y1), (x2, y2), (x2 - 18, y2 + 74), (x1 + 24, y1 + 32)],
            fill=(248, 252, 255, 218),
            outline=(134, 176, 222, 160),
        )
    draw.ellipse((505, 168, 586, 232), fill=(238, 243, 248, 245), outline=(166, 182, 202, 180), width=3)
    draw.ellipse((528, 181, 570, 215), fill=(210, 222, 234, 245))
    draw.arc((110, 62, 260, 220), 16, 322, fill=(255, 255, 255, 85), width=7)
    draw.arc((104, 58, 266, 225), 16, 322, fill=(*accent_rgb, 125), width=3)
    draw.line((160, 205, 82, 312), fill=(255, 255, 255, 90), width=14)
    for i in range(6):
        x = 145 + i * 16
        draw.line((x, 76, 229 - i * 7, 204), fill=(255, 255, 255, 38), width=1)
        draw.line((118, 108 + i * 15, 245, 112 + i * 18), fill=(255, 255, 255, 38), width=1)

    for i in range(26):
        x = 28 + i * 31
        y = 55 + 12 * sin(i * 0.8)
        draw.ellipse((x, y, x + 5, y + 5), fill=(225, 247, 255, 52))

    image = Image.alpha_composite(image.convert("RGBA"), overlay)
    vignette = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    vignette_draw = ImageDraw.Draw(vignette)
    for i in range(90):
        alpha = int(i * 1.15)
        vignette_draw.rectangle((i, i, width - i, height - i), outline=(0, 12, 40, max(0, 100 - alpha)))
    image = Image.alpha_composite(image, vignette)
    image.convert("RGB").save(OUT / name, quality=94)


def icon_svg(inner: str, accent_a: str = "#1d6bff", accent_b: str = "#14c8ff") -> str:
    return f"""
    <svg width="96" height="96" viewBox="0 0 96 96" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="g" x1="18" y1="14" x2="78" y2="86" gradientUnits="userSpaceOnUse">
          <stop stop-color="{accent_a}"/>
          <stop offset="1" stop-color="{accent_b}"/>
        </linearGradient>
        <filter id="shadow" x="0" y="0" width="96" height="96" color-interpolation-filters="sRGB">
          <feDropShadow dx="0" dy="10" stdDeviation="8" flood-color="{accent_a}" flood-opacity=".25"/>
        </filter>
      </defs>
      <rect x="12" y="12" width="72" height="72" rx="24" fill="url(#g)" filter="url(#shadow)"/>
      <g stroke="#fff" stroke-width="5" stroke-linecap="round" stroke-linejoin="round">
        {inner}
      </g>
    </svg>
    """


def generate() -> None:
    generate_competition_cover(
        "competition-cover-1.png",
        ("#04184a", "#075dcc", "#062560"),
        "#ff9d12",
        "#18b8ff",
    )
    generate_competition_cover(
        "competition-cover-2.png",
        ("#043c63", "#00a7b7", "#052d5f"),
        "#ffd45a",
        "#39e4ff",
    )
    generate_competition_cover(
        "competition-cover-3.png",
        ("#14206f", "#6857ff", "#073b8c"),
        "#ff9d12",
        "#8be7ff",
    )
    generate_competition_cover(
        "competition-cover-4.png",
        ("#2c3343", "#5d7c9d", "#12345e"),
        "#cbd5e1",
        "#60a5fa",
    )

    write_svg(
        "logo-badminton.svg",
        """
        <svg width="132" height="92" viewBox="0 0 132 92" fill="none" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="blue" x1="24" y1="8" x2="86" y2="80" gradientUnits="userSpaceOnUse">
              <stop stop-color="#7dd3ff"/>
              <stop offset=".56" stop-color="#2f7cff"/>
              <stop offset="1" stop-color="#003e9f"/>
            </linearGradient>
            <linearGradient id="gold" x1="26" y1="66" x2="92" y2="34" gradientUnits="userSpaceOnUse">
              <stop stop-color="#ff9d12"/>
              <stop offset="1" stop-color="#ffd56a"/>
            </linearGradient>
            <filter id="glow" x="-20" y="-20" width="172" height="132" color-interpolation-filters="sRGB">
              <feDropShadow dx="0" dy="7" stdDeviation="7" flood-color="#1e88ff" flood-opacity=".45"/>
            </filter>
          </defs>
          <path d="M21 67C43 84 78 80 108 52" stroke="url(#gold)" stroke-width="7" stroke-linecap="round"/>
          <path d="M25 72C42 91 74 89 104 67" stroke="#0b63ff" stroke-width="3" stroke-linecap="round" opacity=".65"/>
          <g filter="url(#glow)">
            <ellipse cx="43" cy="60" rx="15" ry="13" transform="rotate(-24 43 60)" fill="#f7fbff"/>
            <path d="M50 48C55 29 61 15 70 7C74 21 73 35 65 52" fill="url(#blue)"/>
            <path d="M57 51C69 35 82 24 95 20C93 35 84 47 67 59" fill="url(#blue)" opacity=".95"/>
            <path d="M62 59C78 50 94 45 108 47C101 60 89 68 69 68" fill="url(#blue)" opacity=".9"/>
            <path d="M52 47L70 8M58 52L95 21M62 60L108 48" stroke="#ffffff" stroke-width="4" stroke-linecap="round" opacity=".9"/>
            <path d="M34 53L49 68" stroke="#23345b" stroke-width="4" stroke-linecap="round"/>
          </g>
        </svg>
        """,
    )

    write_svg(
        "hero-bg.svg",
        """
        <svg width="1600" height="580" viewBox="0 0 1600 580" fill="none" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="bg" x1="0" y1="0" x2="1600" y2="580" gradientUnits="userSpaceOnUse">
              <stop stop-color="#04184a"/>
              <stop offset=".45" stop-color="#075dcc"/>
              <stop offset="1" stop-color="#05255c"/>
            </linearGradient>
            <radialGradient id="light" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(850 120) rotate(114) scale(620 980)">
              <stop stop-color="#69d9ff" stop-opacity=".74"/>
              <stop offset=".36" stop-color="#0f7cff" stop-opacity=".28"/>
              <stop offset="1" stop-color="#071b4d" stop-opacity="0"/>
            </radialGradient>
            <linearGradient id="court" x1="0" y1="420" x2="1600" y2="580" gradientUnits="userSpaceOnUse">
              <stop stop-color="#0e4ea6" stop-opacity=".7"/>
              <stop offset=".5" stop-color="#138e9c" stop-opacity=".74"/>
              <stop offset="1" stop-color="#0a478a" stop-opacity=".65"/>
            </linearGradient>
            <filter id="blur" x="-50" y="-50" width="1700" height="680" color-interpolation-filters="sRGB">
              <feGaussianBlur stdDeviation="3"/>
            </filter>
          </defs>
          <rect width="1600" height="580" fill="url(#bg)"/>
          <rect width="1600" height="580" fill="url(#light)"/>
          <path d="M0 418H1600V580H0V418Z" fill="url(#court)"/>
          <g opacity=".27">
            <path d="M126 565L600 408H1510" stroke="#ffffff" stroke-width="3"/>
            <path d="M420 580L766 408M777 580L946 408M1070 580L1062 408M1280 580L1160 408" stroke="#ffffff" stroke-width="2"/>
            <path d="M0 510H1600M72 456H1535" stroke="#ffffff" stroke-width="2"/>
            <path d="M654 410V580M1048 410V580" stroke="#ffffff" stroke-width="2"/>
          </g>
          <g filter="url(#blur)" opacity=".85">
            <path d="M520 330C780 180 1000 170 1240 92" stroke="#21b7ff" stroke-width="9" stroke-linecap="round"/>
            <path d="M522 365C720 260 870 252 1058 190" stroke="#ff9f1a" stroke-width="6" stroke-linecap="round"/>
            <path d="M500 300C735 204 940 150 1220 32" stroke="#ffffff" stroke-width="3" stroke-linecap="round" opacity=".5"/>
          </g>
          <g opacity=".55">
            <circle cx="980" cy="58" r="5" fill="#bdefff"/>
            <circle cx="1036" cy="82" r="5" fill="#bdefff"/>
            <circle cx="1092" cy="106" r="5" fill="#bdefff"/>
            <circle cx="1148" cy="130" r="5" fill="#bdefff"/>
            <circle cx="1204" cy="154" r="5" fill="#bdefff"/>
            <circle cx="1260" cy="178" r="5" fill="#bdefff"/>
          </g>
          <g opacity=".25">
            <path d="M0 124C250 50 490 56 730 117C1010 188 1300 150 1600 76" stroke="#bfe8ff" stroke-width="2"/>
            <path d="M0 160C250 92 465 100 716 162C978 226 1264 200 1600 126" stroke="#bfe8ff" stroke-width="2"/>
          </g>
          <rect y="0" width="1600" height="580" fill="url(#bg)" opacity=".18"/>
        </svg>
        """,
    )

    write_svg(
        "shuttlecock-glow.svg",
        """
        <svg width="520" height="340" viewBox="0 0 520 340" fill="none" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="trailBlue" x1="0" y1="260" x2="420" y2="90" gradientUnits="userSpaceOnUse">
              <stop stop-color="#16b8ff" stop-opacity="0"/>
              <stop offset=".45" stop-color="#12aaff"/>
              <stop offset="1" stop-color="#eaf8ff"/>
            </linearGradient>
            <linearGradient id="trailOrange" x1="30" y1="300" x2="390" y2="150" gradientUnits="userSpaceOnUse">
              <stop stop-color="#ff9d12" stop-opacity="0"/>
              <stop offset=".62" stop-color="#ff9d12"/>
              <stop offset="1" stop-color="#fff2bd"/>
            </linearGradient>
            <filter id="glow" x="-50" y="-50" width="620" height="440" color-interpolation-filters="sRGB">
              <feDropShadow dx="0" dy="0" stdDeviation="12" flood-color="#22b8ff" flood-opacity=".75"/>
              <feDropShadow dx="0" dy="12" stdDeviation="16" flood-color="#ff9d12" flood-opacity=".32"/>
            </filter>
          </defs>
          <path d="M28 270C155 196 250 154 374 102" stroke="url(#trailBlue)" stroke-width="12" stroke-linecap="round"/>
          <path d="M72 305C196 235 276 202 406 162" stroke="url(#trailOrange)" stroke-width="7" stroke-linecap="round"/>
          <g transform="translate(310 34) rotate(19)" filter="url(#glow)">
            <ellipse cx="64" cy="212" rx="44" ry="38" fill="#f5f7fb"/>
            <ellipse cx="65" cy="211" rx="26" ry="21" fill="#d9e2ef"/>
            <path d="M28 176C25 99 37 42 65 9C86 53 94 108 86 178" fill="#f4f8ff"/>
            <path d="M62 174C83 93 108 38 144 13C148 63 132 120 96 184" fill="#f4f8ff"/>
            <path d="M85 186C129 122 170 86 216 78C203 126 164 165 106 203" fill="#f4f8ff"/>
            <path d="M33 177L65 11M62 176L144 15M86 187L216 79" stroke="#7aa2d8" stroke-width="6" stroke-linecap="round"/>
            <path d="M43 183C60 195 76 202 99 202" stroke="#ff9d12" stroke-width="7" stroke-linecap="round"/>
          </g>
        </svg>
        """,
    )

    write_svg(
        "player-silhouette.svg",
        """
        <svg width="430" height="470" viewBox="0 0 430 470" fill="none" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="body" x1="117" y1="42" x2="318" y2="430" gradientUnits="userSpaceOnUse">
              <stop stop-color="#0f2d68"/>
              <stop offset=".56" stop-color="#061b44"/>
              <stop offset="1" stop-color="#020817"/>
            </linearGradient>
            <filter id="edge" x="0" y="0" width="430" height="470" color-interpolation-filters="sRGB">
              <feDropShadow dx="0" dy="0" stdDeviation="7" flood-color="#18a8ff" flood-opacity=".48"/>
            </filter>
          </defs>
          <g filter="url(#edge)">
            <path d="M247 72C250 49 267 34 291 34C315 34 331 50 328 73C325 96 306 111 283 109C259 106 244 94 247 72Z" fill="url(#body)"/>
            <path d="M246 126C226 141 200 176 184 216C204 233 229 242 262 240C276 206 292 170 306 136C284 120 263 115 246 126Z" fill="url(#body)"/>
            <path d="M191 183C155 190 121 194 83 185C75 183 69 189 70 197C73 208 94 216 122 219C151 222 177 217 202 207L191 183Z" fill="url(#body)"/>
            <path d="M291 152C325 134 350 112 374 82C381 74 393 78 391 90C386 117 356 150 315 180L291 152Z" fill="url(#body)"/>
            <path d="M224 236C204 270 184 299 152 331C135 347 116 352 91 349C77 348 69 363 80 373C101 391 135 389 165 371C195 353 226 320 252 273L224 236Z" fill="url(#body)"/>
            <path d="M266 236C293 265 319 298 350 340C361 356 381 363 405 361C421 360 426 377 413 386C393 401 359 400 337 382C314 362 276 315 239 268L266 236Z" fill="url(#body)"/>
            <path d="M75 351C54 362 39 371 24 390C18 398 24 408 35 405C58 398 76 387 95 372L75 351Z" fill="url(#body)"/>
            <path d="M404 360C417 373 424 385 427 402C429 413 416 419 409 410C395 395 385 381 375 364L404 360Z" fill="url(#body)"/>
            <path d="M373 82L401 28" stroke="#d8ecff" stroke-width="6" stroke-linecap="round"/>
            <ellipse cx="407" cy="18" rx="22" ry="13" transform="rotate(-27 407 18)" stroke="#d8ecff" stroke-width="5"/>
            <path d="M406 7L410 29M394 13L421 23" stroke="#d8ecff" stroke-width="2" stroke-linecap="round"/>
          </g>
        </svg>
        """,
    )

    write_svg(
        "court-lines.svg",
        """
        <svg width="900" height="360" viewBox="0 0 900 360" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect width="900" height="360" rx="24" fill="#eaf5ff"/>
          <g opacity=".45" stroke="#2a7fff" stroke-width="3">
            <rect x="56" y="42" width="788" height="276" rx="8"/>
            <path d="M450 42V318M56 180H844M180 42V318M720 42V318M180 104H720M180 256H720"/>
          </g>
        </svg>
        """,
    )

    write_svg(
        "racket-watermark.svg",
        """
        <svg width="520" height="380" viewBox="0 0 520 380" fill="none" xmlns="http://www.w3.org/2000/svg">
          <g opacity=".16" stroke="#1d6bff" stroke-linecap="round" stroke-linejoin="round">
            <ellipse cx="304" cy="132" rx="82" ry="116" transform="rotate(34 304 132)" stroke-width="10"/>
            <path d="M247 231L132 350" stroke-width="18"/>
            <path d="M188 293L148 253M217 264L177 224" stroke-width="7"/>
            <path d="M235 82L369 179M215 122L347 218M209 166L319 247M273 36L202 196M317 55L236 230M358 86L279 259" stroke-width="3"/>
          </g>
        </svg>
        """,
    )

    write_svg("icon-user.svg", icon_svg('<path d="M35 61c3-10 11-16 23-16s20 6 23 16"/><circle cx="48" cy="38" r="9"/><circle cx="68" cy="38" r="7"/><path d="M64 60c2-6 7-10 15-11"/>'))
    write_svg("icon-calendar.svg", icon_svg('<rect x="28" y="31" width="40" height="36" rx="5"/><path d="M36 25v12M60 25v12M28 43h40M38 53h5M52 53h5"/>'))
    write_svg("icon-trophy.svg", icon_svg('<path d="M36 28h24v13c0 12-7 20-12 20s-12-8-12-20V28Z"/><path d="M36 35H25c0 11 6 17 14 18M60 35h11c0 11-6 17-14 18M48 61v10M38 72h20"/>', "#7567ff", "#1d6bff"))
    write_svg("icon-location.svg", icon_svg('<path d="M48 72s18-17 18-32a18 18 0 1 0-36 0c0 15 18 32 18 32Z"/><circle cx="48" cy="40" r="6"/>'))
    write_svg("icon-bracket.svg", icon_svg('<path d="M28 28h18v14H28zM28 55h18v14H28zM59 41h12v14H59zM46 35h8c5 0 5 13 0 13h-8M46 62h8c5 0 5-13 0-13h-8"/>', "#6d5dfc", "#32b8ff"))
    write_svg("icon-rank.svg", icon_svg('<path d="M30 67V49h10v18M45 67V35h10v32M60 67V43h10v24"/><path d="M63 25l4 8 9 1-7 6 2 9-8-5-8 5 2-9-7-6 9-1 4-8Z" fill="none"/>', "#ff9d12", "#ffd35c"))
    write_svg("icon-megaphone.svg", icon_svg('<path d="M27 50h12l28-14v28L39 50M39 50l6 17H35l-5-17M67 42l5-5M69 51h7M67 60l5 5"/>'))
    write_svg("icon-edit.svg", icon_svg('<path d="M31 66h34M37 56l23-23 8 8-23 23H37v-8Z"/><path d="M55 38l8 8"/>', "#2f7cff", "#11c6ff"))
    write_svg("icon-arrow.svg", icon_svg('<path d="M35 48h25M50 36l12 12-12 12"/>', "#1d6bff", "#6fd8ff"))

    write_svg(
        "footer-pattern.svg",
        """
        <svg width="1600" height="260" viewBox="0 0 1600 260" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect width="1600" height="260" fill="#05215a"/>
          <path d="M0 226C250 150 520 142 800 206C1114 278 1340 236 1600 152" stroke="#2d8cff" stroke-width="8" opacity=".18"/>
          <path d="M-20 98H420M60 230L410 96M380 230L560 96M760 230H1620M935 230L1090 100M1220 230L1280 100" stroke="#ffffff" stroke-width="2" opacity=".12"/>
          <g opacity=".18" stroke="#ffffff" stroke-linecap="round" stroke-linejoin="round">
            <ellipse cx="250" cy="112" rx="72" ry="98" transform="rotate(72 250 112)" stroke-width="8"/>
            <path d="M145 145L26 198" stroke-width="16"/>
            <path d="M174 73L307 151M147 100L273 173M135 127L230 185M221 36L164 176M263 49L197 188M306 80L230 194" stroke-width="3"/>
            <path d="M1365 204c40-28 58-63 64-105M1430 99l-38-18M1405 86l72-48M1467 34c13 13 21 25 28 43M1482 30c16 18 25 33 33 57" stroke-width="6"/>
          </g>
        </svg>
        """,
    )


if __name__ == "__main__":
    generate()
    print(f"Generated SVG assets in {OUT}")
