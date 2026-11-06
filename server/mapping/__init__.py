"""Living world map (DESIGN.md §3.10): one map per Space, built in the
background from every device and every user, refined over time.

  keyframe  binary depth snapshots from devices (format, unprojection)
  voxels    sparse occupancy map: log-odds, ray carving, decay, changes
  planes    surfaces from voxels; merging every source into one surface set
  icp       aligning new observations to the map (gravity-locked, 4-DOF)
  engine    the work itself, run in a separate process (CPU heavy)
  service   the server side: queues, store, pushes
"""
