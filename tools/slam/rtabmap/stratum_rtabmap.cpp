// Feed a Stratum Space's depth keyframes to RTAB-Map as 3-D scans (no
// images needed): device poses (in the Space frame) as odometry, weak links
// between sessions, proximity loop closures by ICP, graph optimization.
// Optional per-frame grayscale image → visual loop closures too.
//
//   stratum_rtabmap <seq dir> [rtabmap params...]
//   seq/frames.txt: id session stamp r00 r01 r02 tx r10 ... tz pts.bin [img.png depth.png fx fy cx cy l00 .. l23]
//     (image: grayscale; depth: uint16, 5000 per m, registered to the image; l: base → optical camera)
//   pts.bin: float32 xyz in the pose's frame (export.py --zup: gravity-aligned base, z up)
//   → seq/rtabmap_poses.txt: id r00 ... tz (optimized), seq/rtabmap_links.txt
#include <rtabmap/core/Rtabmap.h>
#include <rtabmap/core/SensorData.h>
#include <rtabmap/core/util3d.h>
#include <rtabmap/core/util3d_filtering.h>
#include <rtabmap/core/Graph.h>
#include <rtabmap/utilite/ULogger.h>
#include <opencv2/imgcodecs.hpp>
#include <fstream>
#include <sstream>
#include <map>

using namespace rtabmap;

int main(int argc, char **argv) {
  if (argc < 2) { printf("usage: stratum_rtabmap seq [--Param value ...]\n"); return 1; }
  std::string seq = argv[1];
  ULogger::setType(ULogger::kTypeConsole);
  ULogger::setLevel(ULogger::kWarning);
  ParametersMap p;
  p.insert(ParametersPair(Parameters::kRegStrategy(), "1"));                 // ICP
  p.insert(ParametersPair(Parameters::kRGBDProximityBySpace(), "true"));
  p.insert(ParametersPair(Parameters::kRGBDProximityMaxGraphDepth(), "0"));  // anywhere in the graph (other sessions too)
  p.insert(ParametersPair(Parameters::kRGBDProximityPathMaxNeighbors(), "3"));
  p.insert(ParametersPair(Parameters::kRGBDLocalRadius(), "1.5"));
  p.insert(ParametersPair(Parameters::kRGBDLinearUpdate(), "0"));
  p.insert(ParametersPair(Parameters::kRGBDAngularUpdate(), "0"));
  p.insert(ParametersPair(Parameters::kRtabmapDetectionRate(), "0"));
  p.insert(ParametersPair(Parameters::kMemSTMSize(), "10"));
  p.insert(ParametersPair(Parameters::kMemNotLinkedNodesKept(), "false"));
  p.insert(ParametersPair(Parameters::kIcpVoxelSize(), "0.04"));
  p.insert(ParametersPair(Parameters::kMemLaserScanNormalK(), "15"));
  p.insert(ParametersPair(Parameters::kIcpPointToPlane(), "true"));
  p.insert(ParametersPair(Parameters::kIcpPointToPlaneK(), "15"));
  p.insert(ParametersPair(Parameters::kIcpMaxCorrespondenceDistance(), "0.2"));
  p.insert(ParametersPair(Parameters::kIcpMaxTranslation(), "0.8"));
  p.insert(ParametersPair(Parameters::kIcpMaxRotation(), "0.8"));
  p.insert(ParametersPair(Parameters::kIcpIterations(), "40"));
  p.insert(ParametersPair(Parameters::kIcpCorrespondenceRatio(), "0.25"));
  p.insert(ParametersPair(Parameters::kRGBDOptimizeMaxError(), "4"));
  p.insert(ParametersPair(Parameters::kOptimizerIterations(), "100"));
  p.insert(ParametersPair(Parameters::kRegForce3DoF(), "true"));            // gravity is known: x, y, heading only
  bool visual = false;
  for (int i = 2; i + 1 < argc; i += 2) {
    std::string k = argv[i];
    if (k.rfind("--", 0) == 0) k = k.substr(2);
    if (k == "visual") { visual = std::string(argv[i + 1]) == "true"; continue; }
    p[k] = argv[i + 1];
  }
  if (!visual) p[Parameters::kKpMaxFeatures()] = "-1";                      // no images: no bag of words
  else {   // visual + ICP: images find loop closures (bag of words), ICP refines with the depth
    p[Parameters::kRegStrategy()] = "2";
    p[Parameters::kKpMaxFeatures()] = "500";
    p[Parameters::kVisMinInliers()] = "15";
    p[Parameters::kRGBDProximityBySpace()] = "true";
  }

  Rtabmap rtabmap;
  std::string db = seq + "/rtabmap.db";
  std::remove(db.c_str());
  rtabmap.init(p, db);
  std::ifstream in(seq + "/frames.txt");
  std::string line, lastSession;
  std::map<int, std::string> idOf;
  int node = 0, proximity = 0, images = 0, loops = 0;
  const Transform optical(1, 0, 0, 0,  0, -1, 0, 0,  0, 0, -1, 0);           // camera (GL) ← optical
  while (std::getline(in, line)) {
    std::istringstream s(line);
    std::string id, session, pts, img;
    double stamp, m[12];
    s >> id >> session >> stamp;
    for (double &v : m) s >> v;
    s >> pts;
    Transform odom(m[0], m[1], m[2], m[3], m[4], m[5], m[6], m[7], m[8], m[9], m[10], m[11]);
    std::ifstream f(seq + "/" + pts, std::ios::binary | std::ios::ate);
    size_t n = f.tellg() / (3 * sizeof(float));
    f.seekg(0);
    pcl::PointCloud<pcl::PointXYZ>::Ptr cloud(new pcl::PointCloud<pcl::PointXYZ>);
    cloud->resize(n);
    for (size_t i = 0; i < n; ++i) f.read(reinterpret_cast<char *>(&(*cloud)[i].x), 3 * sizeof(float));
    cloud = util3d::voxelize(cloud, 0.03f);
    LaserScan scan = util3d::laserScanFromPointCloud(*cloud);   // normals: Mem/LaserScanNormalK
    SensorData data(scan, cv::Mat(), cv::Mat(), CameraModel(), ++node, stamp);
    std::string dimg;
    if (s >> img >> dimg) {
      double fx, fy, cx, cy, l[12];
      s >> fx >> fy >> cx >> cy;
      for (double &v : l) s >> v;
      Transform local(l[0], l[1], l[2], l[3], l[4], l[5], l[6], l[7], l[8], l[9], l[10], l[11]);
      cv::Mat gray = cv::imread(seq + "/" + img, cv::IMREAD_GRAYSCALE);
      cv::Mat d16 = cv::imread(seq + "/" + dimg, cv::IMREAD_ANYDEPTH);
      if (!gray.empty() && !d16.empty()) {
        cv::Mat depth;
        d16.convertTo(depth, CV_32FC1, 1.0 / 5000.0);   // meters
        data.setRGBDImage(gray, depth, CameraModel(fx, fy, cx, cy, local, 0, gray.size()));
        images++;
      }
    }
    // A new session: the odometry link to it means nothing (its Space frame came from tags).
    // A new session: its link to the last one is loose (its Space frame came from tags: ~1 m).
    cv::Mat cov = cv::Mat::eye(6, 6, CV_64FC1) * (session != lastSession && !lastSession.empty() ? 1.0 : 0.0001);
    rtabmap.process(data, odom, cov);
    idOf[node] = id;
    lastSession = session;
    if (rtabmap.getStatistics().proximityDetectionId() > 0) proximity++;
    if (rtabmap.getStatistics().loopClosureId() > 0) loops++;
    if (node % 100 == 0) { printf("%d frames (%d with images), %d proximity, %d visual loop closures\n", node, images, proximity, loops); fflush(stdout); }
  }
  std::map<int, Transform> poses;
  std::multimap<int, Link> links;
  rtabmap.getGraph(poses, links, true, true);
  std::ofstream out(seq + "/rtabmap_poses.txt");
  for (auto &kv : poses) {
    if (!idOf.count(kv.first)) continue;
    const Transform &t = kv.second;
    out << idOf[kv.first];
    for (int r = 0; r < 3; ++r) for (int c = 0; c < 4; ++c) out << " " << t.data()[r * 4 + c];
    out << "\n";
  }
  std::ofstream lo(seq + "/rtabmap_links.txt");
  int extra = 0;
  for (auto &kv : links) if (kv.second.type() != Link::kNeighbor) { extra++; lo << idOf[kv.second.from()] << " " << idOf[kv.second.to()] << " " << kv.second.type() << "\n"; }
  printf("done: %d frames (%d with images), %zu optimized poses, %d links beyond odometry (%d proximity, %d visual loop closures)\n",
         node, images, poses.size(), extra, proximity, loops);
  rtabmap.close(false);
  return 0;
}
