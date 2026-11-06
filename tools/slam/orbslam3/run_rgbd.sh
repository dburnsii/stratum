#!/bin/sh
# /data/seq: rgb/, depth/, associations.txt, camera.yaml (TUM layout). Writes /data/seq/orbslam3_*.txt
set -e
cd /data/seq
/opt/ORB_SLAM3/Examples/RGB-D/rgbd_tum /opt/ORB_SLAM3/Vocabulary/ORBvoc.txt camera.yaml . associations.txt
mv CameraTrajectory.txt orbslam3_camera.txt 2>/dev/null || true
mv KeyFrameTrajectory.txt orbslam3_keyframes.txt 2>/dev/null || true
