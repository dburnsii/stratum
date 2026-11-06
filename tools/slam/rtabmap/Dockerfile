# RTAB-Map, fed Stratum keyframes (tools/slam/README.md).
FROM introlab3it/rtabmap:latest
COPY stratum_rtabmap.cpp /opt/stratum/
RUN cd /opt/stratum && g++ -O2 -std=c++17 stratum_rtabmap.cpp -o /usr/local/bin/stratum_rtabmap \
    -I/usr/local/include/rtabmap-0.24 $(pkg-config --cflags pcl_common-1.15 2>/dev/null || echo -I/usr/local/include/pcl-1.15 -I/usr/include/pcl-1.15) \
    -I/usr/include/eigen3 -I/usr/local/include/opencv4 -I/usr/include/opencv4 \
    -L/usr/local/lib -lrtabmap_core -lrtabmap_utilite -lopencv_core -lopencv_imgcodecs \
    $(pkg-config --libs pcl_common-1.15 2>/dev/null || echo -lpcl_common)
ENTRYPOINT ["stratum_rtabmap"]
