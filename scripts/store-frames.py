#!/usr/bin/env python3
"""The framed store set, made from the captures with the family's screenshot kit.

  python3 scripts/store-frames.py --kit <kitv2.3 folder> --eyebrow-font <DejaVuSans-Bold.ttf> [iphone] [ipad] [mac] [play] [play-tablet]

The kit is not in this repository (ask the maintainer for the zip; its README
is the authority on every number it holds). Nothing in it is edited or copied:
its framers are imported from where it was unzipped, and the paths, the brand
colour and the chrome tones they hold as module globals are set from here,
which is how the kit's own README says a second app is framed.

It needs Pillow and numpy, and DejaVu Sans Bold for the eyebrow line, which
the kit expects from the system and a Mac does not have.

What goes in is store-assets/captures/ (scripts/store-captures.mjs and
store-capture-popup.mjs), plus one capture each of an iPhone's and an Android
phone's home screen with the widgets on it, made in the simulator and the
emulator (store-assets/README.md says how).
What comes out, in the sizes the stores take:

  store-assets/apple/iphone/   1206 x 2622   "iPhone with Dynamic Island (medium display)"
  store-assets/apple/ipad/     2064 x 2752   iPad 13-inch, the tablet lying down in an upright canvas
  store-assets/apple/mac/      2880 x 1800
  store-assets/play/phone/     1320 x 2640   Google Play's phone slot, exactly its 2:1 limit
  store-assets/play/tablet/    2064 x 2752   Google Play's tablet slots, 7-inch and 10-inch alike

The captions are below, one line each, so a change of wording is a change here.
"""
import argparse, os, sys
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CAPTURES = os.path.join(ROOT, 'store-assets', 'captures')
OUT = os.path.join(ROOT, 'store-assets', 'apple')

# thingGLANCE's sky blue, the accent of its dark theme.
BRAND = (56, 189, 248)

# (capture, eyebrow, first line in warm white, second line in the brand's italic)
IPHONE = [
    ('1-glance',  "WHAT'S NEXT FOR YOUR THINGS", 'Every date that matters,', "before it's too late."),
    ('2-decide',  'NEEDS A DECISION',            'A short list to clear,',   'one decision at a time.'),
    ('3-horizon', 'THE HORIZON',                 'The whole year ahead,',    'on one timeline.'),
    ('4-things',  'SHELF LIFE',                  'How much life is left,',   'in everything you own.'),
    ('5-plans',   'PLANS AND RENEWALS',          'What it all costs,',       'month by month.'),
    ('6-thing',   'THE WHOLE STORY',             'Warranty, support, replacement,', 'on one page.'),
]
WIDGETS = ('ON YOUR HOME SCREEN', "What's next,", 'without opening the app.', [
    'Dates that need a decision',
    'Settle one with a single tap',
    "Each thing's life left, as a ring",
    'Plan charges for the next 30 days',
    'On your Lock Screen too',
])
IPAD = [
    ('1-glance',  'THE BIG PICTURE',    'Everything that needs you,', 'on one screen.'),
    ('3-horizon', 'THE HORIZON',        'Every date ahead,',          'on one timeline.'),
    ('5-plans',   'PLANS AND RENEWALS', 'What it all costs,',         'month by month.'),
]
# Google Play's phone set is the iPhone's, frame for frame, in a Pixel: the
# same captions, on the captures made at the Pixel's own content size. Its
# widgets are Android's own, which are lists where the iPhone's are tiles, and
# there is no Lock Screen to put one on.
PLAY = IPHONE
# And its tablet set is the iPad's, in an Android tablet. The kit's rule is
# that one landscape render serves both tablets, and the size is the same, but
# the captures are its own: the page shows a keyboard shortcut beside the
# search field, written with the Command key on an iPad and with Ctrl here.
PLAY_TABLET = IPAD
PLAY_WIDGETS = (WIDGETS[0], WIDGETS[1], WIDGETS[2], [
    'Clear a decision with a single tap',
    'Plan charges for the next 30 days',
    "Each thing's life left, as a ring",
])

# The Mac's caption is one line: white, then the brand's italic.
MAC = [
    ('1-glance',  'ON YOUR MAC',        "What's next for your things, ", 'in a single window.'),
    ('3-horizon', 'THE HORIZON',        'Every date ahead, ',            'on one timeline.'),
    ('4-things',  'SHELF LIFE',         'How much life is left, ',       'in everything you own.'),
]

# Where the three widget cards sit in the Home Screen capture (an iPhone 17,
# 1206 x 2622), each inset to its last clean pixel, and their corner radius.
# Measured from the capture's own pixels; a looser box lets wallpaper into the
# corners.
HOME = os.path.join(CAPTURES, 'iphone-home', 'home-screen-widgets-dark.png')
CARDS = [(80, 272, 573, 761), (633, 272, 1126, 761), (81, 874, 1125, 1364)]
CARD_RADIUS = 80
# The same for the Android home screen (the emulator's Medium Phone, 1080 x
# 2400): the two lists, then the two rings side by side. It is drawn a little
# larger than it was captured, so the cards fill the wider canvas as the
# iPhone's fill theirs.
PLAY_HOME = os.path.join(CAPTURES, 'pixel-home', 'home-screen-widgets-dark.png')
PLAY_CARDS = [(51, 94, 1030, 644), (51, 676, 1030, 1226), (51, 1258, 520, 1517), (561, 1258, 1030, 1517)]
PLAY_CARD_RADIUS = 66
PLAY_CARD_SCALE = 1.04


def tone(path, where):
    """The app's own chrome tone at the top or bottom edge of a capture."""
    import numpy as np
    a = np.asarray(Image.open(path).convert('RGB'))
    rows = a[2:10] if where == 'top' else a[-10:-2]
    return tuple(int(v) for v in np.median(rows.reshape(-1, 3), axis=0))


def kit(args):
    """The kit's framers, pointed at its own fonts and donors and at this app's colour."""
    sys.path.insert(0, os.path.join(args.kit, 'build-scripts'))
    import build_frame_iphone as iphone, build_frame_ipad_v2 as ipad, build_frame_mac as mac, build_frame_pixel as pixel, build_frame_atablet_v2 as atablet
    fonts, donors = os.path.join(args.kit, 'fonts'), os.path.join(args.kit, 'chrome-donors')
    donor = lambda prefix: os.path.join(donors, next(f for f in os.listdir(donors) if f.startswith(prefix)))
    for m in (iphone, ipad, mac, pixel, atablet):
        m.FONT_SERIF, m.FONT_SERIF_IT = os.path.join(fonts, 'Lora.ttf'), os.path.join(fonts, 'Lora-Italic.ttf')
        m.FONT_SANS_BOLD = args.eyebrow_font
        m.ORANGE = BRAND
    iphone.HER, ipad.DONOR, mac.MAC_DONOR, pixel.CAP = donor('iphone-chrome'), donor('ipad-chrome'), donor('mac-chrome'), donor('pixel-chrome')
    atablet.DONOR = donor('samsung-tablet-chrome')
    return iphone, ipad, mac, pixel, atablet


def frame_iphone(F):
    out = os.path.join(OUT, 'iphone'); os.makedirs(out, exist_ok=True)
    for name, eyebrow, l1, l2 in IPHONE:
        src = os.path.join(CAPTURES, 'iphone', f'{name}-dark.png')
        # tab_bottom is the capture's full height: nothing is cut off it. The
        # bands behind the status bar and the home indicator take the tones of
        # the capture's own top and bottom, which differ when a page is open.
        F.render(src, Image.open(src).height, eyebrow, l1, l2, os.path.join(out, f'{name}.png'),
                 bar_bg=tone(src, 'top'), safe_bg=tone(src, 'bottom'))
    frame_widgets(F, os.path.join(out, '7-widgets.png'), F.CANVASES['di_medium_large'], WIDGETS, HOME, CARDS, CARD_RADIUS)


def frame_widgets(F, out, size, caption, home, cards, radius, scale=1.0, gap=152):
    """The Home Screen's widgets, cut out on their own corners and floated on the house background.

    The kit's widget framer is dayGLANCE's: one card, on the retired 1320-wide
    canvas. This is the same composition (its caption, its halo, its bullets)
    with this app's cards, kept where the home screen has them, on the canvas
    the store takes now. The iPhone's are at their own size; a capture
    narrower than its canvas is scaled, and centred as it was on its screen.
    """
    eyebrow, l1, l2, bullets = caption
    W, H = size
    k = W / 1320
    px = lambda v: int(round(v * k))
    canvas = F.build_bg(W, H).convert('RGBA')
    shot = Image.open(home).convert('RGB')
    if scale != 1.0:
        shot = shot.resize((round(shot.width * scale), round(shot.height * scale)), Image.LANCZOS)
        # Inward, so a scaled box never reaches past the card's last clean pixel.
        cards = [(int(c[0] * scale) + 1, int(c[1] * scale) + 1, int(c[2] * scale), int(c[3] * scale)) for c in cards]
        radius = round(radius * scale)
    dx = (W - shot.width) // 2
    top = px(620)
    dy = top - min(c[1] for c in cards)
    placed = [(shot.crop(c), c[0] + dx, c[1] + dy) for c in cards]
    bottom = max(y + card.height for card, _, y in placed)

    # A near-black card on a near-black ground has no edge: a soft light halo
    # behind each is what separates them (the kit's "lift").
    halo = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    pad = px(70)
    for card, x, y in placed:
        ImageDraw.Draw(halo).rounded_rectangle([x - pad, y - pad, x + card.width + pad, y + card.height + pad], radius=radius + pad, fill=(198, 208, 230, 52))
    canvas = Image.alpha_composite(canvas, halo.filter(ImageFilter.GaussianBlur(px(110))))
    for card, x, y in placed:
        card = card.convert('RGB'); card.putalpha(F.rmask(card.size, radius))
        canvas.paste(card, (x, y), card)

    d = ImageDraw.Draw(canvas); cx = W // 2
    F.tracked(d, cx, px(150), eyebrow, ImageFont.truetype(F.FONT_SANS_BOLD, px(34)), BRAND, px(10))
    size = px(132); target = W - px(210)
    longest = max(d.textlength(l1, font=F.serif(size)), d.textlength(l2, font=F.serif(size, it=True)))
    if longest > target: size = int(size * target / longest)
    f1, f2 = F.serif(size), F.serif(size, it=True)
    y = px(236); lh = int(size * 1.14)
    d.text((cx - d.textlength(l1, font=f1) / 2, y), l1, font=f1, fill=F.WARM_WHITE)
    d.text((cx - d.textlength(l2, font=f2) / 2, y + lh), l2, font=f2, fill=BRAND)

    # The bullets, centred on their real ink between the cards and the bottom.
    fb = F.serif(px(58), it=True); gap = px(gap); dot_r = px(11); dot_x = px(180); text_x = px(232)
    boxes = [d.textbbox((text_x, i * gap), b, font=fb) for i, b in enumerate(bullets)]
    ink_top, ink_bot = min(b[1] for b in boxes), max(b[3] for b in boxes)
    start = bottom + ((H - bottom) - (ink_bot - ink_top)) / 2 - ink_top
    for i, b in enumerate(bullets):
        by = start + i * gap
        x0, y0, x1, y1 = d.textbbox((text_x, by), b, font=fb)
        cy = (y0 + y1) / 2
        d.ellipse([dot_x - dot_r, cy - dot_r, dot_x + dot_r, cy + dot_r], fill=BRAND if i % 2 == 0 else F.WARM_WHITE)
        d.text((text_x, by), b, font=fb, fill=F.WARM_WHITE if i % 2 == 0 else BRAND)
    canvas.convert('RGB').save(out); print('saved', out, canvas.size)


def frame_play(F):
    out = os.path.join(ROOT, 'store-assets', 'play', 'phone'); os.makedirs(out, exist_ok=True)
    for name, eyebrow, l1, l2 in PLAY:
        src = os.path.join(CAPTURES, 'pixel', f'{name}-dark.png')
        # The same call as the iPhone's, but for one keyword: the strip behind
        # the gesture pill is gest_bg here, where the iPhone's is safe_bg.
        F.render(src, Image.open(src).height, eyebrow, l1, l2, os.path.join(out, f'{name}.png'),
                 bar_bg=tone(src, 'top'), gest_bg=tone(src, 'bottom'))
    # The kit's Pixel framer holds this canvas as a constant, not in a table.
    frame_widgets(F, os.path.join(out, '7-widgets.png'), (1320, 2640), PLAY_WIDGETS, PLAY_HOME, PLAY_CARDS, PLAY_CARD_RADIUS, PLAY_CARD_SCALE, gap=140)


def frame_play_tablet(F):
    import numpy as np
    out = os.path.join(ROOT, 'store-assets', 'play', 'tablet'); os.makedirs(out, exist_ok=True)
    kit_recolor = F.recolor

    def recolor(block, new_bg, **tones):
        # The kit's crop of the donor's gesture strip starts a few rows early,
        # in the donor's own app, which comes through as a faint line above
        # the pill. A row of the strip is the strip's dark from edge to edge
        # with at most the pill in it, so a row with none of that dark is not
        # the strip, and is put on the dark before the kit recolours it.
        if tones.get('lo') == 35:
            a = np.asarray(block).copy(); lum = a.mean(axis=2)
            dark = np.median(a.reshape(-1, 3), axis=0)
            a[lum.min(axis=1) > 35] = dark
            block = Image.fromarray(a.astype('uint8'))
        return kit_recolor(block, new_bg, **tones)

    F.recolor = recolor
    try:
        for name, eyebrow, l1, l2 in PLAY_TABLET:
            # The iPad's numbers: the same tablet lying down, with an Android
            # status bar above it and a gesture pill below, each on the
            # capture's own tone.
            src = os.path.join(CAPTURES, 'atablet', f'{name}-dark.png')
            F.render(src, eyebrow, l1, l2, tone(src, 'top'), tone(src, 'bottom'), os.path.join(out, f'{name}.png'), body_w=1832, device_top=880, show_date=False)
    finally:
        F.recolor = kit_recolor


def frame_ipad(F):
    out = os.path.join(OUT, 'ipad'); os.makedirs(out, exist_ok=True)
    for name, eyebrow, l1, l2 in IPAD:
        src = os.path.join(CAPTURES, 'ipad', f'{name}-dark.png')
        # A tablet lying down in the upright canvas: body_w is the upright
        # device's height, and the donor's date is cut off its status bar.
        F.render(src, eyebrow, l1, l2, tone(src, 'top'), os.path.join(out, f'{name}.png'), body_w=1832, device_top=880, show_date=False)


def frame_mac(F):
    out = os.path.join(OUT, 'mac'); os.makedirs(out, exist_ok=True)
    kit_window = F.build_window

    def window(content_path, win_w):
        # The kit stacks the donor's real title bar above the app. Its bar is
        # dayGLANCE's tone, a lighter stripe over this app's darker header, so
        # the bar is put on this app's own tone first: the traffic lights are
        # the donor's pixels, and the dark behind them is replaced.
        import build_frame_iphone as phone
        donor = Image.open(F.MAC_DONOR).convert('RGB')
        bar = phone.recolor_chrome(donor.crop((116, 76, 3131, 133)), None, tone(content_path, 'top'))
        content = Image.open(content_path).convert('RGB')
        bar = bar.resize((content.width, round(bar.height * content.width / bar.width)))
        win = Image.new('RGB', (content.width, bar.height + content.height))
        win.paste(bar, (0, 0)); win.paste(content, (0, bar.height))
        win_h = int(win_w * win.height / win.width)
        w = win.resize((win_w, win_h)); r = int(win_w * 0.010)
        w.putalpha(F.rmask((win_w, win_h), r))
        ImageDraw.Draw(w).rounded_rectangle([0, 0, win_w - 1, win_h - 1], radius=r, outline=(70, 74, 82, 140), width=2)
        return w

    F.build_window = window
    try:
        for name, eyebrow, white, brand in MAC:
            F.render(os.path.join(CAPTURES, 'mac-plain', f'{name}-dark.png'), eyebrow, white, brand, os.path.join(out, f'{name}.png'))
    finally:
        F.build_window = kit_window


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    p.add_argument('--kit', required=True, help='the unzipped kit folder (the one holding build-scripts, fonts and chrome-donors)')
    p.add_argument('--eyebrow-font', required=True, help='DejaVuSans-Bold.ttf')
    p.add_argument('sets', nargs='*', choices=['iphone', 'ipad', 'mac', 'play', 'play-tablet', []], help='which sets (all of them when none is named)')
    args = p.parse_args()
    iphone, ipad, mac, pixel, atablet = kit(args)
    sets = args.sets or ['iphone', 'ipad', 'mac', 'play', 'play-tablet']
    if 'iphone' in sets: frame_iphone(iphone)
    if 'ipad' in sets: frame_ipad(ipad)
    if 'mac' in sets: frame_mac(mac)
    if 'play' in sets: frame_play(pixel)
    if 'play-tablet' in sets: frame_play_tablet(atablet)
