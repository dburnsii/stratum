"""In-process pub/sub keyed by Space id, with an ACL filter on fan-out.

Swap for Redis/NATS channels (`space:{id}`) when running more than one
server process (DESIGN.md §9). The interface stays: subscribe / publish.
"""
import asyncio
import json
import uuid
from collections import defaultdict

SEND_QUEUE_MAX = 256


class Conn:
    """One WebSocket client. Messages go through a bounded queue so a slow
    client can't stall fan-out for everyone else."""

    def __init__(self, ws, user):
        self.ws = ws
        self.user = user
        self.layers = set()   # layer ids this user may view; refreshed on sub
        self.spaces = set()
        self.channels = set()   # app channel keys "app:<app>:<channel>"
        self.queue = asyncio.Queue(SEND_QUEUE_MAX)
        self.id = uuid.uuid4().hex[:12]   # presence: tells people's avatars apart
        self.writer = asyncio.create_task(self._write())

    async def _write(self):
        while True:
            data = await self.queue.get()
            if data is None:
                return
            try:
                await self.ws.send_str(data)
            except ConnectionResetError:
                return

    def send(self, msg, droppable=False):
        """Queue a message. If the queue is full, drop hot (droppable) data;
        for cold data close the socket so the client reconnects and resyncs
        via REST, which is always correct."""
        try:
            self.queue.put_nowait(json.dumps(msg))
        except asyncio.QueueFull:
            if not droppable:
                asyncio.create_task(self.ws.close())

    def close(self):
        self.writer.cancel()


class Hub:
    def __init__(self):
        self.subs = defaultdict(set)      # space id -> {Conn}
        self.channels = defaultdict(dict)  # app channel key -> {Conn: None}, in join order

    def subscribe(self, conn, spaces, layers):
        for s in conn.spaces - spaces:
            self.subs[s].discard(conn)
        for s in spaces:
            self.subs[s].add(conn)
        conn.spaces = spaces
        conn.layers = layers

    def drop(self, conn):
        for s in conn.spaces:
            self.subs[s].discard(conn)
        for k in conn.channels:
            self.channels[k].pop(conn, None)
        left = conn.channels
        conn.spaces = set()
        conn.channels = set()
        conn.close()
        for k in left:
            self.announce_host(k)

    # App channels: per app instance rooms for live app data (DESIGN.md §6).
    # Keys are "app:<app>:<channel>"; access is checked by the caller.
    #
    # Each room has a host: whoever has been in it longest. Apps run shared
    # simulations there (physics, game rules) and others follow its state
    # (DESIGN.md §6.4). Every membership change re-announces the host and
    # the room size to everyone in it.
    def join_channels(self, conn, keys):
        changed = (conn.channels - keys) | (keys - conn.channels)
        for k in conn.channels - keys:
            self.channels[k].pop(conn, None)
        for k in keys:
            self.channels[k].setdefault(conn, None)
        conn.channels = keys
        for k in changed:
            self.announce_host(k)

    def announce_host(self, key):
        members = list(self.channels.get(key, {}))
        if not members:
            self.channels.pop(key, None)
            return
        _, app, channel = key.split(":", 2)
        msg = {"t": "host", "app": app, "channel": channel, "host": members[0].id, "peers": len(members)}
        for conn in members:
            conn.send(msg)

    def publish_channel(self, key, msg, exclude=None):
        n = 0
        for conn in list(self.channels.get(key, ())):
            if conn is not exclude:
                conn.send(msg, droppable=True)
                n += 1
        return n

    def publish_space(self, space_id, msg, exclude=None, droppable=False):
        """Everyone subscribed to a Space, regardless of layers (presence,
        membership changes)."""
        for conn in list(self.subs.get(space_id, ())):
            if conn is not exclude:
                conn.send(msg, droppable)

    def drop_presence(self, conn):
        for s in conn.spaces:
            self.publish_space(s, {"t": "gone", "space": s, "from": conn.id}, exclude=conn, droppable=True)

    def publish(self, space_id, layer_id, msg, exclude=None, droppable=False):
        for conn in list(self.subs.get(space_id, ())):
            if conn is not exclude and layer_id in conn.layers:
                conn.send(msg, droppable)
