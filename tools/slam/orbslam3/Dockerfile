# ORB-SLAM3 (RGB-D / mono), headless: for offline map experiments (tools/slam/README.md).
FROM ubuntu:22.04
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential cmake git pkg-config ca-certificates wget unzip \
    libeigen3-dev libopencv-dev libglew-dev libgl1-mesa-dev libegl1-mesa-dev libwayland-dev libxkbcommon-dev wayland-protocols \
    libboost-serialization-dev libssl-dev python3 && rm -rf /var/lib/apt/lists/*
WORKDIR /opt
RUN git clone --depth 1 --branch v0.8 https://github.com/stevenlovegrove/Pangolin.git && \
    cd Pangolin && mkdir build && cd build && cmake .. -DCMAKE_BUILD_TYPE=Release -DBUILD_EXAMPLES=OFF -DBUILD_TESTS=OFF && make -j"$(nproc)" install && ldconfig
RUN git clone --depth 1 https://github.com/UZ-SLAMLab/ORB_SLAM3.git && cd ORB_SLAM3 && \
    sed -i 's/++11/++14/g' CMakeLists.txt && \
    sed -i 's/-march=native//g' CMakeLists.txt Thirdparty/DBoW2/CMakeLists.txt Thirdparty/g2o/CMakeLists.txt && \
    sed -i 's/ORB_SLAM3::System::RGBD,true/ORB_SLAM3::System::RGBD,false/; s/ORB_SLAM3::System::MONOCULAR,true/ORB_SLAM3::System::MONOCULAR,false/' Examples/RGB-D/rgbd_tum.cc Examples/Monocular/mono_tum.cc && \
    (cd Thirdparty/DBoW2 && mkdir build && cd build && cmake .. -DCMAKE_BUILD_TYPE=Release && make -j"$(nproc)") && \
    (cd Thirdparty/g2o && mkdir build && cd build && cmake .. -DCMAKE_BUILD_TYPE=Release && make -j"$(nproc)") && \
    (cd Thirdparty/Sophus && mkdir build && cd build && cmake .. -DCMAKE_BUILD_TYPE=Release -DBUILD_TESTS=OFF && make -j"$(nproc)") && \
    (cd Vocabulary && tar -xf ORBvoc.txt.tar.gz) && \
    mkdir build && cd build && cmake .. -DCMAKE_BUILD_TYPE=Release && make -j"$(nproc)" rgbd_tum mono_tum
COPY run_rgbd.sh /opt/run_rgbd.sh
ENTRYPOINT ["/opt/run_rgbd.sh"]
