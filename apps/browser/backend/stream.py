"""Picture and sound of a pane, for its WebSocket.

Video: the active tab's content area is grabbed from the player's display
(X11, 30 fps) and encoded per socket: H.264 (the headset decodes it in
hardware, WebCodecs), VP8 (browsers without H.264), or JPEG frames (no
WebCodecs at all; only when the picture changed, ≤ 10 fps). A thread per
stream; encoded chunks are handed to the event loop.

Sound: the player's Chrome plays into its own PulseAudio sink; its monitor
is recorded (parec) and encoded as Opus, 20 ms packets.

Wire format (binary messages): 1 byte kind, 1 byte flags (1 = key frame),
8 bytes timestamp (µs, big-endian), then the payload.
"""
import asyncio
import struct
import subprocess
import threading
import time
from fractions import Fraction

import av

VIDEO, AUDIO, JPEG = 1, 2, 3
FPS = 30
JPEG_FPS = 10
KEY_EVERY_S = 2
BITRATE = 4_000_000
CODECS = {   # ours → (encoder, WebCodecs codec string)
    "h264": ("libx264", "avc1.42E028"),   # Constrained Baseline, level 4.0
    "vp8": ("libvpx", "vp8"),
}


def header(kind, key, ts_us):
    return struct.pack(">BBQ", kind, 1 if key else 0, ts_us)


class VideoStream:
    """Grabs a display rectangle and encodes it; retarget() follows tab switches."""
    def __init__(self, display, rect, codec, send):
        self.display, self.rect, self.codec, self.send = display, rect, codec, send
        self.loop = asyncio.get_running_loop()
        self.stop_flag = threading.Event()
        self.want_key = threading.Event()
        self.moved = threading.Event()
        self.thread = threading.Thread(target=self.run, daemon=True)
        self.thread.start()

    def config(self):
        x, y, w, h = self.rect
        return {"t": "config", "codec": CODECS[self.codec][1] if self.codec in CODECS else "jpeg", "width": w, "height": h}

    def retarget(self, rect):
        if rect != self.rect:
            self.rect = rect
            self.moved.set()

    def key(self):
        self.want_key.set()

    def close(self):
        self.stop_flag.set()

    def emit(self, data):
        if not self.stop_flag.is_set():
            self.loop.call_soon_threadsafe(self.send, data)

    def encoder(self, w, h):
        name = CODECS[self.codec][0] if self.codec in CODECS else "mjpeg"
        enc = av.CodecContext.create(name, "w")
        enc.width, enc.height = w, h
        enc.time_base = Fraction(1, 1_000_000)
        if name == "mjpeg":
            enc.pix_fmt = "yuvj420p"
            enc.options = {"q:v": "5"}
        else:
            enc.pix_fmt = "yuv420p"
            enc.bit_rate = BITRATE
            enc.gop_size = FPS * KEY_EVERY_S
            enc.framerate = Fraction(FPS, 1)
            if name == "libx264":
                enc.profile = "baseline"
                enc.options = {"preset": "ultrafast", "tune": "zerolatency",
                               "x264-params": f"keyint={FPS * KEY_EVERY_S}:scenecut=0:repeat-headers=1:bframes=0"}
            else:
                enc.options = {"deadline": "realtime", "cpu-used": "8", "lag-in-frames": "0", "error-resilient": "1"}
        enc.open()
        return enc

    def run(self):
        while not self.stop_flag.is_set():
            x, y, w, h = self.rect
            self.moved.clear()
            try:
                grab = av.open(f"{self.display}+{x},{y}", format="x11grab",
                               options={"video_size": f"{w}x{h}", "framerate": str(FPS), "draw_mouse": "0"})
            except Exception:
                time.sleep(0.5)
                continue
            try:
                self.pump(grab, w, h)
            finally:
                grab.close()

    def pump(self, grab, w, h):
        enc = self.encoder(w, h)
        jpeg = enc.name == "mjpeg"
        t0 = time.monotonic()
        last_jpeg, last_sum, first = 0.0, None, True
        for frame in grab.decode(video=0):
            if self.stop_flag.is_set() or self.moved.is_set():
                return
            now = time.monotonic()
            ts = int((now - t0) * 1_000_000)
            if jpeg:
                if now - last_jpeg < 1 / JPEG_FPS:
                    continue
                img = frame.reformat(format="yuvj420p")
                sig = hash(bytes(img.planes[0])[::997])   # cheap "did anything change"
                if sig == last_sum and not self.want_key.is_set():
                    continue
                last_sum, last_jpeg = sig, now
                self.want_key.clear()
                img.pts = ts
                for pkt in enc.encode(img):
                    self.emit(header(JPEG, True, ts) + bytes(pkt))
                continue
            img = frame.reformat(format="yuv420p")
            img.pts = ts
            # Grabbed frames come marked as key frames: the encoder decides, unless a key frame is wanted.
            if first or self.want_key.is_set():
                img.pict_type = av.video.frame.PictureType.I
                self.want_key.clear()
                first = False
            else:
                img.pict_type = av.video.frame.PictureType.NONE
            for pkt in enc.encode(img):
                self.emit(header(VIDEO, pkt.is_keyframe, ts) + bytes(pkt))


class AudioStream:
    """The player's sound as Opus packets, while anyone listens."""
    RATE, CH, FRAME = 48000, 2, 960   # 20 ms

    def __init__(self, env, sink, send):
        self.env, self.sink, self.send = env, sink, send
        self.task = asyncio.create_task(self.run())

    def close(self):
        self.task.cancel()

    async def run(self):
        proc = await asyncio.create_subprocess_exec(
            "parec", "-d", f"{self.sink}.monitor", "--format=s16le", f"--rate={self.RATE}", f"--channels={self.CH}",
            "--latency-msec=20", env=self.env, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        enc = av.CodecContext.create("libopus", "w")
        enc.sample_rate, enc.layout, enc.format = self.RATE, "stereo", "s16"
        enc.time_base = Fraction(1, self.RATE)
        enc.bit_rate = 128_000
        enc.open()
        size = self.FRAME * self.CH * 2
        pts = 0
        t0 = time.monotonic()
        try:
            while True:
                chunk = await proc.stdout.readexactly(size)
                frame = av.AudioFrame(format="s16", layout="stereo", samples=self.FRAME)
                frame.planes[0].update(chunk)
                frame.sample_rate, frame.pts = self.RATE, pts
                pts += self.FRAME
                ts = int((time.monotonic() - t0) * 1_000_000)
                for pkt in enc.encode(frame):
                    self.send(header(AUDIO, True, ts) + bytes(pkt))
        except (asyncio.CancelledError, asyncio.IncompleteReadError):
            pass
        finally:
            if proc.returncode is None:
                proc.kill()
