"""Tiny valid glTF binaries for tests (one triangle, optionally animated)."""
import json
import struct


def make_glb(animated=False):
    pos = struct.pack("<9f", 0, 0, 0, 1, 0, 0, 0, 2, 0)            # 1 x 2 m triangle
    idx = struct.pack("<3H", 0, 1, 2) + b"\0\0"
    times = struct.pack("<2f", 0, 1)
    rots = struct.pack("<8f", 0, 0, 0, 1, 0, 0.7071, 0, 0.7071)
    binary = pos + idx + (times + rots if animated else b"")
    gltf = {
        "asset": {"version": "2.0"}, "scene": 0, "scenes": [{"nodes": [0]}],
        "nodes": [{"mesh": 0}],
        "meshes": [{"primitives": [{"attributes": {"POSITION": 0}, "indices": 1}]}],
        "buffers": [{"byteLength": len(binary)}],
        "bufferViews": [{"buffer": 0, "byteOffset": 0, "byteLength": 36},
                        {"buffer": 0, "byteOffset": 36, "byteLength": 6}],
        "accessors": [{"bufferView": 0, "componentType": 5126, "count": 3, "type": "VEC3", "min": [0, 0, 0], "max": [1, 2, 0]},
                      {"bufferView": 1, "componentType": 5123, "count": 3, "type": "SCALAR"}],
    }
    if animated:
        gltf["bufferViews"] += [{"buffer": 0, "byteOffset": 44, "byteLength": 8}, {"buffer": 0, "byteOffset": 52, "byteLength": 32}]
        gltf["accessors"] += [{"bufferView": 2, "componentType": 5126, "count": 2, "type": "SCALAR", "min": [0], "max": [1]},
                              {"bufferView": 3, "componentType": 5126, "count": 2, "type": "VEC4"}]
        gltf["animations"] = [{"name": "swim", "samplers": [{"input": 2, "output": 3}],
                               "channels": [{"sampler": 0, "target": {"node": 0, "path": "rotation"}}]}]
    js = json.dumps(gltf).encode()
    js += b" " * (-len(js) % 4)
    binary += b"\0" * (-len(binary) % 4)
    body = struct.pack("<II", len(js), 0x4E4F534A) + js + struct.pack("<II", len(binary), 0x004E4942) + binary
    return b"glTF" + struct.pack("<II", 2, 12 + len(body)) + body
