# SLAM experiments (offline)

Compare how well a Space's map comes out with poses from different systems.
Nothing here runs in the server; it reads `data/stratum.db` + `data/map/`.

| Step | Command |
|---|---|
| Build | `docker build -t stratum-rtabmap tools/slam/rtabmap` · `docker build -t stratum-orbslam3 tools/slam/orbslam3` |
| RTAB-Map (depth only, works on any map) | `python tools/slam/export.py <space> /tmp/seqz --zup` → `docker run --rm -v /tmp/seqz:/seq stratum-rtabmap /seq` → `python tools/slam/export.py from-zup /tmp/seqz /tmp/seqz/rtabmap_poses.txt /tmp/rtab.txt` |
| ORB-SLAM3 (needs keyframes with camera images, v48+) | `python tools/slam/tum.py export <space> /tmp/tum --device quest` → `docker run --rm -v /tmp/tum:/data/seq stratum-orbslam3` → `python tools/slam/tum.py import /tmp/tum /tmp/tum/orbslam3_camera.txt /tmp/orb.txt` |
| Score | `python tools/slam/compare.py <space> /tmp/cmp --raw --ours rtabmap=/tmp/rtab.txt orbslam3=/tmp/orb.txt` (needs matplotlib) |

compare.py prints, per pose source: keyframes used, occupied voxels, floor
thickness (σ of floor voxel heights), wall thickness (median over walls of
the 80th-percentile distance of voxels from the wall plane), how many walls
and how much wall area were found, and renders a top-down + slice per run.

Camera images: the client attaches a ≤320 px grayscale camera image to depth
keyframes (phone AR camera; Quest headset camera) unless
`localStorage['stratum.mapImages'] = '0'`. The server keeps it in the
keyframe (`img` header + bytes after the depth); the map itself ignores it.
