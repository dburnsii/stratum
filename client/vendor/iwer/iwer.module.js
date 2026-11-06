/**
 * Common utilities
 * @module glMatrix
 */

// Configuration Constants
var EPSILON = 0.000001;
var ARRAY_TYPE$1 = typeof Float32Array !== "undefined" ? Float32Array : Array;

/**
 * 3x3 Matrix
 * @module mat3
 */

/**
 * Creates a new identity mat3
 *
 * @returns {mat3} a new 3x3 matrix
 */
function create$6() {
  var out = new ARRAY_TYPE$1(9);
  if (ARRAY_TYPE$1 != Float32Array) {
    out[1] = 0;
    out[2] = 0;
    out[3] = 0;
    out[5] = 0;
    out[6] = 0;
    out[7] = 0;
  }
  out[0] = 1;
  out[4] = 1;
  out[8] = 1;
  return out;
}

/**
 * 4x4 Matrix<br>Format: column-major, when typed out it looks like row-major<br>The matrices are being post multiplied.
 * @module mat4
 */

/**
 * Creates a new identity mat4
 *
 * @returns {mat4} a new 4x4 matrix
 */
function create$5() {
  var out = new ARRAY_TYPE$1(16);
  if (ARRAY_TYPE$1 != Float32Array) {
    out[1] = 0;
    out[2] = 0;
    out[3] = 0;
    out[4] = 0;
    out[6] = 0;
    out[7] = 0;
    out[8] = 0;
    out[9] = 0;
    out[11] = 0;
    out[12] = 0;
    out[13] = 0;
    out[14] = 0;
  }
  out[0] = 1;
  out[5] = 1;
  out[10] = 1;
  out[15] = 1;
  return out;
}

/**
 * Creates a new mat4 initialized with values from an existing matrix
 *
 * @param {ReadonlyMat4} a matrix to clone
 * @returns {mat4} a new 4x4 matrix
 */
function clone(a) {
  var out = new ARRAY_TYPE$1(16);
  out[0] = a[0];
  out[1] = a[1];
  out[2] = a[2];
  out[3] = a[3];
  out[4] = a[4];
  out[5] = a[5];
  out[6] = a[6];
  out[7] = a[7];
  out[8] = a[8];
  out[9] = a[9];
  out[10] = a[10];
  out[11] = a[11];
  out[12] = a[12];
  out[13] = a[13];
  out[14] = a[14];
  out[15] = a[15];
  return out;
}

/**
 * Copy the values from one mat4 to another
 *
 * @param {mat4} out the receiving matrix
 * @param {ReadonlyMat4} a the source matrix
 * @returns {mat4} out
 */
function copy$3(out, a) {
  out[0] = a[0];
  out[1] = a[1];
  out[2] = a[2];
  out[3] = a[3];
  out[4] = a[4];
  out[5] = a[5];
  out[6] = a[6];
  out[7] = a[7];
  out[8] = a[8];
  out[9] = a[9];
  out[10] = a[10];
  out[11] = a[11];
  out[12] = a[12];
  out[13] = a[13];
  out[14] = a[14];
  out[15] = a[15];
  return out;
}

/**
 * Set a mat4 to the identity matrix
 *
 * @param {mat4} out the receiving matrix
 * @returns {mat4} out
 */
function identity(out) {
  out[0] = 1;
  out[1] = 0;
  out[2] = 0;
  out[3] = 0;
  out[4] = 0;
  out[5] = 1;
  out[6] = 0;
  out[7] = 0;
  out[8] = 0;
  out[9] = 0;
  out[10] = 1;
  out[11] = 0;
  out[12] = 0;
  out[13] = 0;
  out[14] = 0;
  out[15] = 1;
  return out;
}

/**
 * Inverts a mat4
 *
 * @param {mat4} out the receiving matrix
 * @param {ReadonlyMat4} a the source matrix
 * @returns {mat4 | null} out, or null if source matrix is not invertible
 */
function invert$1(out, a) {
  var a00 = a[0],
    a01 = a[1],
    a02 = a[2],
    a03 = a[3];
  var a10 = a[4],
    a11 = a[5],
    a12 = a[6],
    a13 = a[7];
  var a20 = a[8],
    a21 = a[9],
    a22 = a[10],
    a23 = a[11];
  var a30 = a[12],
    a31 = a[13],
    a32 = a[14],
    a33 = a[15];
  var b00 = a00 * a11 - a01 * a10;
  var b01 = a00 * a12 - a02 * a10;
  var b02 = a00 * a13 - a03 * a10;
  var b03 = a01 * a12 - a02 * a11;
  var b04 = a01 * a13 - a03 * a11;
  var b05 = a02 * a13 - a03 * a12;
  var b06 = a20 * a31 - a21 * a30;
  var b07 = a20 * a32 - a22 * a30;
  var b08 = a20 * a33 - a23 * a30;
  var b09 = a21 * a32 - a22 * a31;
  var b10 = a21 * a33 - a23 * a31;
  var b11 = a22 * a33 - a23 * a32;

  // Calculate the determinant
  var det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (!det) {
    return null;
  }
  det = 1.0 / det;
  out[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det;
  out[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
  out[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det;
  out[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
  out[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det;
  out[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
  out[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det;
  out[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
  out[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det;
  out[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
  out[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
  out[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
  out[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det;
  out[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
  out[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det;
  out[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
  return out;
}

/**
 * Multiplies two mat4s
 *
 * @param {mat4} out the receiving matrix
 * @param {ReadonlyMat4} a the first operand
 * @param {ReadonlyMat4} b the second operand
 * @returns {mat4} out
 */
function multiply$2(out, a, b) {
  var a00 = a[0],
    a01 = a[1],
    a02 = a[2],
    a03 = a[3];
  var a10 = a[4],
    a11 = a[5],
    a12 = a[6],
    a13 = a[7];
  var a20 = a[8],
    a21 = a[9],
    a22 = a[10],
    a23 = a[11];
  var a30 = a[12],
    a31 = a[13],
    a32 = a[14],
    a33 = a[15];

  // Cache only the current line of the second matrix
  var b0 = b[0],
    b1 = b[1],
    b2 = b[2],
    b3 = b[3];
  out[0] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
  out[1] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
  out[2] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
  out[3] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
  b0 = b[4];
  b1 = b[5];
  b2 = b[6];
  b3 = b[7];
  out[4] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
  out[5] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
  out[6] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
  out[7] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
  b0 = b[8];
  b1 = b[9];
  b2 = b[10];
  b3 = b[11];
  out[8] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
  out[9] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
  out[10] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
  out[11] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
  b0 = b[12];
  b1 = b[13];
  b2 = b[14];
  b3 = b[15];
  out[12] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
  out[13] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
  out[14] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
  out[15] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
  return out;
}

/**
 * Creates a matrix from a vector translation
 * This is equivalent to (but much faster than):
 *
 *     mat4.identity(dest);
 *     mat4.translate(dest, dest, vec);
 *
 * @param {mat4} out mat4 receiving operation result
 * @param {ReadonlyVec3} v Translation vector
 * @returns {mat4} out
 */
function fromTranslation(out, v) {
  out[0] = 1;
  out[1] = 0;
  out[2] = 0;
  out[3] = 0;
  out[4] = 0;
  out[5] = 1;
  out[6] = 0;
  out[7] = 0;
  out[8] = 0;
  out[9] = 0;
  out[10] = 1;
  out[11] = 0;
  out[12] = v[0];
  out[13] = v[1];
  out[14] = v[2];
  out[15] = 1;
  return out;
}

/**
 * Creates a matrix from a given angle around a given axis
 * This is equivalent to (but much faster than):
 *
 *     mat4.identity(dest);
 *     mat4.rotate(dest, dest, rad, axis);
 *
 * @param {mat4} out mat4 receiving operation result
 * @param {Number} rad the angle to rotate the matrix by
 * @param {ReadonlyVec3} axis the axis to rotate around
 * @returns {mat4} out
 */
function fromRotation(out, rad, axis) {
  var x = axis[0],
    y = axis[1],
    z = axis[2];
  var len = Math.sqrt(x * x + y * y + z * z);
  var s, c, t;
  if (len < EPSILON) {
    return null;
  }
  len = 1 / len;
  x *= len;
  y *= len;
  z *= len;
  s = Math.sin(rad);
  c = Math.cos(rad);
  t = 1 - c;

  // Perform rotation-specific matrix multiplication
  out[0] = x * x * t + c;
  out[1] = y * x * t + z * s;
  out[2] = z * x * t - y * s;
  out[3] = 0;
  out[4] = x * y * t - z * s;
  out[5] = y * y * t + c;
  out[6] = z * y * t + x * s;
  out[7] = 0;
  out[8] = x * z * t + y * s;
  out[9] = y * z * t - x * s;
  out[10] = z * z * t + c;
  out[11] = 0;
  out[12] = 0;
  out[13] = 0;
  out[14] = 0;
  out[15] = 1;
  return out;
}

/**
 * Creates a matrix from a quaternion rotation and vector translation
 * This is equivalent to (but much faster than):
 *
 *     mat4.identity(dest);
 *     mat4.translate(dest, dest, vec);
 *     let quatMat = mat4.create();
 *     mat4.fromQuat(quatMat, quat);
 *     mat4.multiply(dest, dest, quatMat);
 *
 * @param {mat4} out mat4 receiving operation result
 * @param {quat} q Rotation quaternion
 * @param {ReadonlyVec3} v Translation vector
 * @returns {mat4} out
 */
function fromRotationTranslation(out, q, v) {
  // Quaternion math
  var x = q[0],
    y = q[1],
    z = q[2],
    w = q[3];
  var x2 = x + x;
  var y2 = y + y;
  var z2 = z + z;
  var xx = x * x2;
  var xy = x * y2;
  var xz = x * z2;
  var yy = y * y2;
  var yz = y * z2;
  var zz = z * z2;
  var wx = w * x2;
  var wy = w * y2;
  var wz = w * z2;
  out[0] = 1 - (yy + zz);
  out[1] = xy + wz;
  out[2] = xz - wy;
  out[3] = 0;
  out[4] = xy - wz;
  out[5] = 1 - (xx + zz);
  out[6] = yz + wx;
  out[7] = 0;
  out[8] = xz + wy;
  out[9] = yz - wx;
  out[10] = 1 - (xx + yy);
  out[11] = 0;
  out[12] = v[0];
  out[13] = v[1];
  out[14] = v[2];
  out[15] = 1;
  return out;
}

/**
 * Returns the translation vector component of a transformation
 *  matrix. If a matrix is built with fromRotationTranslation,
 *  the returned vector will be the same as the translation vector
 *  originally supplied.
 * @param  {vec3} out Vector to receive translation component
 * @param  {ReadonlyMat4} mat Matrix to be decomposed (input)
 * @return {vec3} out
 */
function getTranslation(out, mat) {
  out[0] = mat[12];
  out[1] = mat[13];
  out[2] = mat[14];
  return out;
}

/**
 * Returns the scaling factor component of a transformation
 *  matrix. If a matrix is built with fromRotationTranslationScale
 *  with a normalized Quaternion parameter, the returned vector will be
 *  the same as the scaling vector
 *  originally supplied.
 * @param  {vec3} out Vector to receive scaling factor component
 * @param  {ReadonlyMat4} mat Matrix to be decomposed (input)
 * @return {vec3} out
 */
function getScaling(out, mat) {
  var m11 = mat[0];
  var m12 = mat[1];
  var m13 = mat[2];
  var m21 = mat[4];
  var m22 = mat[5];
  var m23 = mat[6];
  var m31 = mat[8];
  var m32 = mat[9];
  var m33 = mat[10];
  out[0] = Math.sqrt(m11 * m11 + m12 * m12 + m13 * m13);
  out[1] = Math.sqrt(m21 * m21 + m22 * m22 + m23 * m23);
  out[2] = Math.sqrt(m31 * m31 + m32 * m32 + m33 * m33);
  return out;
}

/**
 * Returns a quaternion representing the rotational component
 *  of a transformation matrix. If a matrix is built with
 *  fromRotationTranslation, the returned quaternion will be the
 *  same as the quaternion originally supplied.
 * @param {quat} out Quaternion to receive the rotation component
 * @param {ReadonlyMat4} mat Matrix to be decomposed (input)
 * @return {quat} out
 */
function getRotation(out, mat) {
  var scaling = new ARRAY_TYPE$1(3);
  getScaling(scaling, mat);
  var is1 = 1 / scaling[0];
  var is2 = 1 / scaling[1];
  var is3 = 1 / scaling[2];
  var sm11 = mat[0] * is1;
  var sm12 = mat[1] * is2;
  var sm13 = mat[2] * is3;
  var sm21 = mat[4] * is1;
  var sm22 = mat[5] * is2;
  var sm23 = mat[6] * is3;
  var sm31 = mat[8] * is1;
  var sm32 = mat[9] * is2;
  var sm33 = mat[10] * is3;
  var trace = sm11 + sm22 + sm33;
  var S = 0;
  if (trace > 0) {
    S = Math.sqrt(trace + 1.0) * 2;
    out[3] = 0.25 * S;
    out[0] = (sm23 - sm32) / S;
    out[1] = (sm31 - sm13) / S;
    out[2] = (sm12 - sm21) / S;
  } else if (sm11 > sm22 && sm11 > sm33) {
    S = Math.sqrt(1.0 + sm11 - sm22 - sm33) * 2;
    out[3] = (sm23 - sm32) / S;
    out[0] = 0.25 * S;
    out[1] = (sm12 + sm21) / S;
    out[2] = (sm31 + sm13) / S;
  } else if (sm22 > sm33) {
    S = Math.sqrt(1.0 + sm22 - sm11 - sm33) * 2;
    out[3] = (sm31 - sm13) / S;
    out[0] = (sm12 + sm21) / S;
    out[1] = 0.25 * S;
    out[2] = (sm23 + sm32) / S;
  } else {
    S = Math.sqrt(1.0 + sm33 - sm11 - sm22) * 2;
    out[3] = (sm12 - sm21) / S;
    out[0] = (sm31 + sm13) / S;
    out[1] = (sm23 + sm32) / S;
    out[2] = 0.25 * S;
  }
  return out;
}

/**
 * Creates a matrix from a quaternion rotation, vector translation and vector scale
 * This is equivalent to (but much faster than):
 *
 *     mat4.identity(dest);
 *     mat4.translate(dest, dest, vec);
 *     let quatMat = mat4.create();
 *     mat4.fromQuat(quatMat, quat);
 *     mat4.multiply(dest, dest, quatMat);
 *     mat4.scale(dest, dest, scale)
 *
 * @param {mat4} out mat4 receiving operation result
 * @param {quat} q Rotation quaternion
 * @param {ReadonlyVec3} v Translation vector
 * @param {ReadonlyVec3} s Scaling vector
 * @returns {mat4} out
 */
function fromRotationTranslationScale(out, q, v, s) {
  // Quaternion math
  var x = q[0],
    y = q[1],
    z = q[2],
    w = q[3];
  var x2 = x + x;
  var y2 = y + y;
  var z2 = z + z;
  var xx = x * x2;
  var xy = x * y2;
  var xz = x * z2;
  var yy = y * y2;
  var yz = y * z2;
  var zz = z * z2;
  var wx = w * x2;
  var wy = w * y2;
  var wz = w * z2;
  var sx = s[0];
  var sy = s[1];
  var sz = s[2];
  out[0] = (1 - (yy + zz)) * sx;
  out[1] = (xy + wz) * sx;
  out[2] = (xz - wy) * sx;
  out[3] = 0;
  out[4] = (xy - wz) * sy;
  out[5] = (1 - (xx + zz)) * sy;
  out[6] = (yz + wx) * sy;
  out[7] = 0;
  out[8] = (xz + wy) * sz;
  out[9] = (yz - wx) * sz;
  out[10] = (1 - (xx + yy)) * sz;
  out[11] = 0;
  out[12] = v[0];
  out[13] = v[1];
  out[14] = v[2];
  out[15] = 1;
  return out;
}

/**
 * Generates a perspective projection matrix with the given bounds.
 * The near/far clip planes correspond to a normalized device coordinate Z range of [-1, 1],
 * which matches WebGL/OpenGL's clip volume.
 * Passing null/undefined/no value for far will generate infinite projection matrix.
 *
 * @param {mat4} out mat4 frustum matrix will be written into
 * @param {number} fovy Vertical field of view in radians
 * @param {number} aspect Aspect ratio. typically viewport width/height
 * @param {number} near Near bound of the frustum
 * @param {number} far Far bound of the frustum, can be null or Infinity
 * @returns {mat4} out
 */
function perspectiveNO(out, fovy, aspect, near, far) {
  var f = 1.0 / Math.tan(fovy / 2);
  out[0] = f / aspect;
  out[1] = 0;
  out[2] = 0;
  out[3] = 0;
  out[4] = 0;
  out[5] = f;
  out[6] = 0;
  out[7] = 0;
  out[8] = 0;
  out[9] = 0;
  out[11] = -1;
  out[12] = 0;
  out[13] = 0;
  out[15] = 0;
  if (far != null && far !== Infinity) {
    var nf = 1 / (near - far);
    out[10] = (far + near) * nf;
    out[14] = 2 * far * near * nf;
  } else {
    out[10] = -1;
    out[14] = -2 * near;
  }
  return out;
}

/**
 * Alias for {@link mat4.perspectiveNO}
 * @function
 */
var perspective = perspectiveNO;

/**
 * 3 Dimensional Vector
 * @module vec3
 */

/**
 * Creates a new, empty vec3
 *
 * @returns {vec3} a new 3D vector
 */
function create$4() {
  var out = new ARRAY_TYPE$1(3);
  if (ARRAY_TYPE$1 != Float32Array) {
    out[0] = 0;
    out[1] = 0;
    out[2] = 0;
  }
  return out;
}

/**
 * Calculates the length of a vec3
 *
 * @param {ReadonlyVec3} a vector to calculate length of
 * @returns {Number} length of a
 */
function length(a) {
  var x = a[0];
  var y = a[1];
  var z = a[2];
  return Math.sqrt(x * x + y * y + z * z);
}

/**
 * Creates a new vec3 initialized with the given values
 *
 * @param {Number} x X component
 * @param {Number} y Y component
 * @param {Number} z Z component
 * @returns {vec3} a new 3D vector
 */
function fromValues$2(x, y, z) {
  var out = new ARRAY_TYPE$1(3);
  out[0] = x;
  out[1] = y;
  out[2] = z;
  return out;
}

/**
 * Copy the values from one vec3 to another
 *
 * @param {vec3} out the receiving vector
 * @param {ReadonlyVec3} a the source vector
 * @returns {vec3} out
 */
function copy$2(out, a) {
  out[0] = a[0];
  out[1] = a[1];
  out[2] = a[2];
  return out;
}

/**
 * Set the components of a vec3 to the given values
 *
 * @param {vec3} out the receiving vector
 * @param {Number} x X component
 * @param {Number} y Y component
 * @param {Number} z Z component
 * @returns {vec3} out
 */
function set$2(out, x, y, z) {
  out[0] = x;
  out[1] = y;
  out[2] = z;
  return out;
}

/**
 * Adds two vec3's
 *
 * @param {vec3} out the receiving vector
 * @param {ReadonlyVec3} a the first operand
 * @param {ReadonlyVec3} b the second operand
 * @returns {vec3} out
 */
function add(out, a, b) {
  out[0] = a[0] + b[0];
  out[1] = a[1] + b[1];
  out[2] = a[2] + b[2];
  return out;
}

/**
 * Calculates the squared euclidian distance between two vec3's
 *
 * @param {ReadonlyVec3} a the first operand
 * @param {ReadonlyVec3} b the second operand
 * @returns {Number} squared distance between a and b
 */
function squaredDistance(a, b) {
  var x = b[0] - a[0];
  var y = b[1] - a[1];
  var z = b[2] - a[2];
  return x * x + y * y + z * z;
}

/**
 * Normalize a vec3
 *
 * @param {vec3} out the receiving vector
 * @param {ReadonlyVec3} a vector to normalize
 * @returns {vec3} out
 */
function normalize$2(out, a) {
  var x = a[0];
  var y = a[1];
  var z = a[2];
  var len = x * x + y * y + z * z;
  if (len > 0) {
    //TODO: evaluate use of glm_invsqrt here?
    len = 1 / Math.sqrt(len);
  }
  out[0] = a[0] * len;
  out[1] = a[1] * len;
  out[2] = a[2] * len;
  return out;
}

/**
 * Calculates the dot product of two vec3's
 *
 * @param {ReadonlyVec3} a the first operand
 * @param {ReadonlyVec3} b the second operand
 * @returns {Number} dot product of a and b
 */
function dot$2(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/**
 * Computes the cross product of two vec3's
 *
 * @param {vec3} out the receiving vector
 * @param {ReadonlyVec3} a the first operand
 * @param {ReadonlyVec3} b the second operand
 * @returns {vec3} out
 */
function cross(out, a, b) {
  var ax = a[0],
    ay = a[1],
    az = a[2];
  var bx = b[0],
    by = b[1],
    bz = b[2];
  out[0] = ay * bz - az * by;
  out[1] = az * bx - ax * bz;
  out[2] = ax * by - ay * bx;
  return out;
}

/**
 * Performs a linear interpolation between two vec3's
 *
 * @param {vec3} out the receiving vector
 * @param {ReadonlyVec3} a the first operand
 * @param {ReadonlyVec3} b the second operand
 * @param {Number} t interpolation amount, in the range [0-1], between the two inputs
 * @returns {vec3} out
 */
function lerp$1(out, a, b, t) {
  var ax = a[0];
  var ay = a[1];
  var az = a[2];
  out[0] = ax + t * (b[0] - ax);
  out[1] = ay + t * (b[1] - ay);
  out[2] = az + t * (b[2] - az);
  return out;
}

/**
 * Transforms the vec3 with a mat4.
 * 4th vector component is implicitly '1'
 *
 * @param {vec3} out the receiving vector
 * @param {ReadonlyVec3} a the vector to transform
 * @param {ReadonlyMat4} m matrix to transform with
 * @returns {vec3} out
 */
function transformMat4$1(out, a, m) {
  var x = a[0],
    y = a[1],
    z = a[2];
  var w = m[3] * x + m[7] * y + m[11] * z + m[15];
  w = w || 1.0;
  out[0] = (m[0] * x + m[4] * y + m[8] * z + m[12]) / w;
  out[1] = (m[1] * x + m[5] * y + m[9] * z + m[13]) / w;
  out[2] = (m[2] * x + m[6] * y + m[10] * z + m[14]) / w;
  return out;
}

/**
 * Transforms the vec3 with a quat
 * Can also be used for dual quaternions. (Multiply it with the real part)
 *
 * @param {vec3} out the receiving vector
 * @param {ReadonlyVec3} a the vector to transform
 * @param {ReadonlyQuat} q normalized quaternion to transform with
 * @returns {vec3} out
 */
function transformQuat(out, a, q) {
  // Fast Vector Rotation using Quaternions by Robert Eisele
  // https://raw.org/proof/vector-rotation-using-quaternions/

  var qx = q[0],
    qy = q[1],
    qz = q[2],
    qw = q[3];
  var vx = a[0],
    vy = a[1],
    vz = a[2];

  // t = q x v
  var tx = qy * vz - qz * vy;
  var ty = qz * vx - qx * vz;
  var tz = qx * vy - qy * vx;

  // t = 2t
  tx = tx + tx;
  ty = ty + ty;
  tz = tz + tz;

  // v + w t + q x t
  out[0] = vx + qw * tx + qy * tz - qz * ty;
  out[1] = vy + qw * ty + qz * tx - qx * tz;
  out[2] = vz + qw * tz + qx * ty - qy * tx;
  return out;
}

/**
 * Alias for {@link vec3.length}
 * @function
 */
var len = length;

/**
 * Perform some operation over an array of vec3s.
 *
 * @param {Array} a the array of vectors to iterate over
 * @param {Number} stride Number of elements between the start of each vec3. If 0 assumes tightly packed
 * @param {Number} offset Number of elements to skip at the beginning of the array
 * @param {Number} count Number of vec3s to iterate over. If 0 iterates over entire array
 * @param {Function} fn Function to call for each vector in the array
 * @param {Object} [arg] additional argument to pass to fn
 * @returns {Array} a
 * @function
 */
(function () {
  var vec = create$4();
  return function (a, stride, offset, count, fn, arg) {
    var i, l;
    if (!stride) {
      stride = 3;
    }
    if (!offset) {
      offset = 0;
    }
    if (count) {
      l = Math.min(count * stride + offset, a.length);
    } else {
      l = a.length;
    }
    for (i = offset; i < l; i += stride) {
      vec[0] = a[i];
      vec[1] = a[i + 1];
      vec[2] = a[i + 2];
      fn(vec, vec, arg);
      a[i] = vec[0];
      a[i + 1] = vec[1];
      a[i + 2] = vec[2];
    }
    return a;
  };
})();

/**
 * 4 Dimensional Vector
 * @module vec4
 */

/**
 * Creates a new, empty vec4
 *
 * @returns {vec4} a new 4D vector
 */
function create$3() {
  var out = new ARRAY_TYPE$1(4);
  if (ARRAY_TYPE$1 != Float32Array) {
    out[0] = 0;
    out[1] = 0;
    out[2] = 0;
    out[3] = 0;
  }
  return out;
}

/**
 * Creates a new vec4 initialized with the given values
 *
 * @param {Number} x X component
 * @param {Number} y Y component
 * @param {Number} z Z component
 * @param {Number} w W component
 * @returns {vec4} a new 4D vector
 */
function fromValues$1(x, y, z, w) {
  var out = new ARRAY_TYPE$1(4);
  out[0] = x;
  out[1] = y;
  out[2] = z;
  out[3] = w;
  return out;
}

/**
 * Copy the values from one vec4 to another
 *
 * @param {vec4} out the receiving vector
 * @param {ReadonlyVec4} a the source vector
 * @returns {vec4} out
 */
function copy$1(out, a) {
  out[0] = a[0];
  out[1] = a[1];
  out[2] = a[2];
  out[3] = a[3];
  return out;
}

/**
 * Set the components of a vec4 to the given values
 *
 * @param {vec4} out the receiving vector
 * @param {Number} x X component
 * @param {Number} y Y component
 * @param {Number} z Z component
 * @param {Number} w W component
 * @returns {vec4} out
 */
function set$1(out, x, y, z, w) {
  out[0] = x;
  out[1] = y;
  out[2] = z;
  out[3] = w;
  return out;
}

/**
 * Normalize a vec4
 *
 * @param {vec4} out the receiving vector
 * @param {ReadonlyVec4} a vector to normalize
 * @returns {vec4} out
 */
function normalize$1(out, a) {
  var x = a[0];
  var y = a[1];
  var z = a[2];
  var w = a[3];
  var len = x * x + y * y + z * z + w * w;
  if (len > 0) {
    len = 1 / Math.sqrt(len);
  }
  out[0] = x * len;
  out[1] = y * len;
  out[2] = z * len;
  out[3] = w * len;
  return out;
}

/**
 * Calculates the dot product of two vec4's
 *
 * @param {ReadonlyVec4} a the first operand
 * @param {ReadonlyVec4} b the second operand
 * @returns {Number} dot product of a and b
 */
function dot$1(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
}

/**
 * Transforms the vec4 with a mat4.
 *
 * @param {vec4} out the receiving vector
 * @param {ReadonlyVec4} a the vector to transform
 * @param {ReadonlyMat4} m matrix to transform with
 * @returns {vec4} out
 */
function transformMat4(out, a, m) {
  var x = a[0],
    y = a[1],
    z = a[2],
    w = a[3];
  out[0] = m[0] * x + m[4] * y + m[8] * z + m[12] * w;
  out[1] = m[1] * x + m[5] * y + m[9] * z + m[13] * w;
  out[2] = m[2] * x + m[6] * y + m[10] * z + m[14] * w;
  out[3] = m[3] * x + m[7] * y + m[11] * z + m[15] * w;
  return out;
}

/**
 * Perform some operation over an array of vec4s.
 *
 * @param {Array} a the array of vectors to iterate over
 * @param {Number} stride Number of elements between the start of each vec4. If 0 assumes tightly packed
 * @param {Number} offset Number of elements to skip at the beginning of the array
 * @param {Number} count Number of vec4s to iterate over. If 0 iterates over entire array
 * @param {Function} fn Function to call for each vector in the array
 * @param {Object} [arg] additional argument to pass to fn
 * @returns {Array} a
 * @function
 */
(function () {
  var vec = create$3();
  return function (a, stride, offset, count, fn, arg) {
    var i, l;
    if (!stride) {
      stride = 4;
    }
    if (!offset) {
      offset = 0;
    }
    if (count) {
      l = Math.min(count * stride + offset, a.length);
    } else {
      l = a.length;
    }
    for (i = offset; i < l; i += stride) {
      vec[0] = a[i];
      vec[1] = a[i + 1];
      vec[2] = a[i + 2];
      vec[3] = a[i + 3];
      fn(vec, vec, arg);
      a[i] = vec[0];
      a[i + 1] = vec[1];
      a[i + 2] = vec[2];
      a[i + 3] = vec[3];
    }
    return a;
  };
})();

/**
 * Quaternion in the format XYZW
 * @module quat
 */

/**
 * Creates a new identity quat
 *
 * @returns {quat} a new quaternion
 */
function create$2() {
  var out = new ARRAY_TYPE$1(4);
  if (ARRAY_TYPE$1 != Float32Array) {
    out[0] = 0;
    out[1] = 0;
    out[2] = 0;
  }
  out[3] = 1;
  return out;
}

/**
 * Sets a quat from the given angle and rotation axis,
 * then returns it.
 *
 * @param {quat} out the receiving quaternion
 * @param {ReadonlyVec3} axis the axis around which to rotate
 * @param {Number} rad the angle in radians
 * @returns {quat} out
 **/
function setAxisAngle(out, axis, rad) {
  rad = rad * 0.5;
  var s = Math.sin(rad);
  out[0] = s * axis[0];
  out[1] = s * axis[1];
  out[2] = s * axis[2];
  out[3] = Math.cos(rad);
  return out;
}

/**
 * Multiplies two quat's
 *
 * @param {quat} out the receiving quaternion
 * @param {ReadonlyQuat} a the first operand
 * @param {ReadonlyQuat} b the second operand
 * @returns {quat} out
 */
function multiply$1(out, a, b) {
  var ax = a[0],
    ay = a[1],
    az = a[2],
    aw = a[3];
  var bx = b[0],
    by = b[1],
    bz = b[2],
    bw = b[3];
  out[0] = ax * bw + aw * bx + ay * bz - az * by;
  out[1] = ay * bw + aw * by + az * bx - ax * bz;
  out[2] = az * bw + aw * bz + ax * by - ay * bx;
  out[3] = aw * bw - ax * bx - ay * by - az * bz;
  return out;
}

/**
 * Performs a spherical linear interpolation between two quat
 *
 * @param {quat} out the receiving quaternion
 * @param {ReadonlyQuat} a the first operand
 * @param {ReadonlyQuat} b the second operand
 * @param {Number} t interpolation amount, in the range [0-1], between the two inputs
 * @returns {quat} out
 */
function slerp(out, a, b, t) {
  // benchmarks:
  //    http://jsperf.com/quaternion-slerp-implementations
  var ax = a[0],
    ay = a[1],
    az = a[2],
    aw = a[3];
  var bx = b[0],
    by = b[1],
    bz = b[2],
    bw = b[3];
  var omega, cosom, sinom, scale0, scale1;

  // calc cosine
  cosom = ax * bx + ay * by + az * bz + aw * bw;
  // adjust signs (if necessary)
  if (cosom < 0.0) {
    cosom = -cosom;
    bx = -bx;
    by = -by;
    bz = -bz;
    bw = -bw;
  }
  // calculate coefficients
  if (1.0 - cosom > EPSILON) {
    // standard case (slerp)
    omega = Math.acos(cosom);
    sinom = Math.sin(omega);
    scale0 = Math.sin((1.0 - t) * omega) / sinom;
    scale1 = Math.sin(t * omega) / sinom;
  } else {
    // "from" and "to" quaternions are very close
    //  ... so we can do a linear interpolation
    scale0 = 1.0 - t;
    scale1 = t;
  }
  // calculate final values
  out[0] = scale0 * ax + scale1 * bx;
  out[1] = scale0 * ay + scale1 * by;
  out[2] = scale0 * az + scale1 * bz;
  out[3] = scale0 * aw + scale1 * bw;
  return out;
}

/**
 * Calculates the inverse of a quat
 *
 * @param {quat} out the receiving quaternion
 * @param {ReadonlyQuat} a quat to calculate inverse of
 * @returns {quat} out
 */
function invert(out, a) {
  var a0 = a[0],
    a1 = a[1],
    a2 = a[2],
    a3 = a[3];
  var dot = a0 * a0 + a1 * a1 + a2 * a2 + a3 * a3;
  var invDot = dot ? 1.0 / dot : 0;

  // TODO: Would be faster to return [0,0,0,0] immediately if dot == 0

  out[0] = -a0 * invDot;
  out[1] = -a1 * invDot;
  out[2] = -a2 * invDot;
  out[3] = a3 * invDot;
  return out;
}

/**
 * Calculates the conjugate of a quat
 * If the quaternion is normalized, this function is faster than quat.inverse and produces the same result.
 *
 * @param {quat} out the receiving quaternion
 * @param {ReadonlyQuat} a quat to calculate conjugate of
 * @returns {quat} out
 */
function conjugate(out, a) {
  out[0] = -a[0];
  out[1] = -a[1];
  out[2] = -a[2];
  out[3] = a[3];
  return out;
}

/**
 * Creates a quaternion from the given 3x3 rotation matrix.
 *
 * NOTE: The resultant quaternion is not normalized, so you should be sure
 * to renormalize the quaternion yourself where necessary.
 *
 * @param {quat} out the receiving quaternion
 * @param {ReadonlyMat3} m rotation matrix
 * @returns {quat} out
 * @function
 */
function fromMat3(out, m) {
  // Algorithm in Ken Shoemake's article in 1987 SIGGRAPH course notes
  // article "Quaternion Calculus and Fast Animation".
  var fTrace = m[0] + m[4] + m[8];
  var fRoot;
  if (fTrace > 0.0) {
    // |w| > 1/2, may as well choose w > 1/2
    fRoot = Math.sqrt(fTrace + 1.0); // 2w
    out[3] = 0.5 * fRoot;
    fRoot = 0.5 / fRoot; // 1/(4w)
    out[0] = (m[5] - m[7]) * fRoot;
    out[1] = (m[6] - m[2]) * fRoot;
    out[2] = (m[1] - m[3]) * fRoot;
  } else {
    // |w| <= 1/2
    var i = 0;
    if (m[4] > m[0]) i = 1;
    if (m[8] > m[i * 3 + i]) i = 2;
    var j = (i + 1) % 3;
    var k = (i + 2) % 3;
    fRoot = Math.sqrt(m[i * 3 + i] - m[j * 3 + j] - m[k * 3 + k] + 1.0);
    out[i] = 0.5 * fRoot;
    fRoot = 0.5 / fRoot;
    out[3] = (m[j * 3 + k] - m[k * 3 + j]) * fRoot;
    out[j] = (m[j * 3 + i] + m[i * 3 + j]) * fRoot;
    out[k] = (m[k * 3 + i] + m[i * 3 + k]) * fRoot;
  }
  return out;
}

/**
 * Creates a new quat initialized with the given values
 *
 * @param {Number} x X component
 * @param {Number} y Y component
 * @param {Number} z Z component
 * @param {Number} w W component
 * @returns {quat} a new quaternion
 * @function
 */
var fromValues = fromValues$1;

/**
 * Copy the values from one quat to another
 *
 * @param {quat} out the receiving quaternion
 * @param {ReadonlyQuat} a the source quaternion
 * @returns {quat} out
 * @function
 */
var copy = copy$1;

/**
 * Set the components of a quat to the given values
 *
 * @param {quat} out the receiving quaternion
 * @param {Number} x X component
 * @param {Number} y Y component
 * @param {Number} z Z component
 * @param {Number} w W component
 * @returns {quat} out
 * @function
 */
var set = set$1;

/**
 * Calculates the dot product of two quat's
 *
 * @param {ReadonlyQuat} a the first operand
 * @param {ReadonlyQuat} b the second operand
 * @returns {Number} dot product of a and b
 * @function
 */
var dot = dot$1;

/**
 * Normalize a quat
 *
 * @param {quat} out the receiving quaternion
 * @param {ReadonlyQuat} a quaternion to normalize
 * @returns {quat} out
 * @function
 */
var normalize = normalize$1;

/**
 * Sets a quaternion to represent the shortest rotation from one
 * vector to another.
 *
 * Both vectors are assumed to be unit length.
 *
 * @param {quat} out the receiving quaternion.
 * @param {ReadonlyVec3} a the initial vector
 * @param {ReadonlyVec3} b the destination vector
 * @returns {quat} out
 */
(function () {
  var tmpvec3 = create$4();
  var xUnitVec3 = fromValues$2(1, 0, 0);
  var yUnitVec3 = fromValues$2(0, 1, 0);
  return function (out, a, b) {
    var dot = dot$2(a, b);
    if (dot < -0.999999) {
      cross(tmpvec3, xUnitVec3, a);
      if (len(tmpvec3) < 0.000001) cross(tmpvec3, yUnitVec3, a);
      normalize$2(tmpvec3, tmpvec3);
      setAxisAngle(out, tmpvec3, Math.PI);
      return out;
    } else if (dot > 0.999999) {
      out[0] = 0;
      out[1] = 0;
      out[2] = 0;
      out[3] = 1;
      return out;
    } else {
      cross(tmpvec3, a, b);
      out[0] = tmpvec3[0];
      out[1] = tmpvec3[1];
      out[2] = tmpvec3[2];
      out[3] = 1 + dot;
      return normalize(out, out);
    }
  };
})();

/**
 * Performs a spherical linear interpolation with two control points
 *
 * @param {quat} out the receiving quaternion
 * @param {ReadonlyQuat} a the first operand
 * @param {ReadonlyQuat} b the second operand
 * @param {ReadonlyQuat} c the third operand
 * @param {ReadonlyQuat} d the fourth operand
 * @param {Number} t interpolation amount, in the range [0-1], between the two inputs
 * @returns {quat} out
 */
(function () {
  var temp1 = create$2();
  var temp2 = create$2();
  return function (out, a, b, c, d, t) {
    slerp(temp1, a, d, t);
    slerp(temp2, b, c, t);
    slerp(out, temp1, temp2, 2 * t * (1 - t));
    return out;
  };
})();

/**
 * Sets the specified quaternion with values corresponding to the given
 * axes. Each axis is a vec3 and is expected to be unit length and
 * perpendicular to all other specified axes.
 *
 * @param {ReadonlyVec3} view  the vector representing the viewing direction
 * @param {ReadonlyVec3} right the vector representing the local "right" direction
 * @param {ReadonlyVec3} up    the vector representing the local "up" direction
 * @returns {quat} out
 */
(function () {
  var matr = create$6();
  return function (out, view, right, up) {
    matr[0] = right[0];
    matr[3] = right[1];
    matr[6] = right[2];
    matr[1] = up[0];
    matr[4] = up[1];
    matr[7] = up[2];
    matr[2] = -view[0];
    matr[5] = -view[1];
    matr[8] = -view[2];
    return normalize(out, fromMat3(out, matr));
  };
})();

/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
const P_ACTION_PLAYER = Symbol('@iwer/action-player');
const P_ACTION_RECORDER = Symbol('@iwer/action-recorder');
const P_ANCHOR = Symbol('@iwer/xr-anchor');
const P_CONTROLLER = Symbol('@iwer/xr-controller');
const P_DEVICE = Symbol('@iwer/xr-device');
const P_HAND_INPUT = Symbol('@iwer/xr-hand-input');
const P_TRACKED_INPUT = Symbol('@iwer/xr-tracked-input');
const P_FRAME = Symbol('@iwer/xr-frame');
const P_GAMEPAD = Symbol('@iwer/gamepad');
const P_SYSTEM = Symbol('@iwer/xr-system');
const P_INPUT_SOURCE = Symbol('@iwer/xr-input-source');
const P_WEBGL_LAYER = Symbol('@iwer/xr-webgl-layer');
const P_MESH = Symbol('@iwer/xr-mesh');
const P_PLANE = Symbol('@iwer/xr-plane');
const P_JOINT_POSE = Symbol('@iwer/xr-joint-pose');
const P_POSE = Symbol('@iwer/xr-pose');
const P_VIEWER_POSE = Symbol('@iwer/xr-viewer-pose');
const P_RIGID_TRANSFORM = Symbol('@iwer/xr-rigid-transform');
const P_RENDER_STATE = Symbol('@iwer/xr-render-state');
const P_SESSION = Symbol('@iwer/xr-session');
const P_JOINT_SPACE = Symbol('@iwer/xr-joint-space');
const P_REF_SPACE = Symbol('@iwer/xr-reference-space');
const P_SPACE = Symbol('@iwer/xr-space');
const P_VIEW = Symbol('@iwer/xr-view');
const P_VIEWPORT = Symbol('@iwer/xr-viewport');
const P_RAY = Symbol('@iwer/xr-ray');
const P_DEPTH_INFO = Symbol('@iwer/xr-depth-info');
const P_HIT_TEST = Symbol('@iwer/xr-hit-test');

/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
// Module-level scratch reused by XRSpaceUtils to avoid per-call allocations on
// the per-frame pose path. Each use is fully consumed before the next call.
const scratchTranslation = create$4();
class XRSpace extends EventTarget {
    constructor(parentSpace, offsetMatrix) {
        super();
        this[P_SPACE] = {
            parentSpace,
            offsetMatrix: offsetMatrix ? clone(offsetMatrix) : create$5(),
            emulated: true,
        };
    }
}
class GlobalSpace extends XRSpace {
    constructor() {
        super(undefined, create$5()); // GlobalSpace has no parent
    }
}
class XRSpaceUtils {
    // Update the position component of the offsetMatrix of a given XRSpace
    static updateOffsetPosition(space, position) {
        const offsetMatrix = space[P_SPACE].offsetMatrix;
        fromTranslation(offsetMatrix, position);
    }
    // Update the rotation component of the offsetMatrix of a given XRSpace using a quaternion
    static updateOffsetQuaternion(space, quaternion) {
        const offsetMatrix = space[P_SPACE].offsetMatrix;
        getTranslation(scratchTranslation, offsetMatrix);
        fromRotationTranslation(offsetMatrix, quaternion, scratchTranslation);
    }
    // Update the offsetMatrix of a given XRSpace directly
    static updateOffsetMatrix(space, matrix) {
        const offsetMatrix = space[P_SPACE].offsetMatrix;
        copy$3(offsetMatrix, matrix);
    }
    // Calculate the global offset matrix for a given XRSpace.
    //
    // Walks up the parent chain iteratively and folds each ancestor's offset
    // matrix into `globalOffset` (root-first). The previous recursive form
    // allocated a throwaway mat4 for every level of the hierarchy on every call,
    // which is hot: getPose -> getOffsetMatrix calls this twice per pose, many
    // times per frame. This version allocates nothing beyond the (small) chain
    // array and never shares module scratch, so callers that pass two distinct
    // output matrices (see getOffsetMatrix) stay correct.
    static calculateGlobalOffsetMatrix(space, globalOffset = create$5()) {
        const chain = [];
        let current = space;
        while (current) {
            chain.push(current);
            current = current[P_SPACE].parentSpace;
        }
        // chain is [space, ..., root]; multiply offsets in root -> space order.
        identity(globalOffset);
        for (let i = chain.length - 1; i >= 0; i--) {
            multiply$2(globalOffset, globalOffset, chain[i][P_SPACE].offsetMatrix);
        }
        return globalOffset;
    }
}

/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
/**
 * Wrapper class for gl-matrix vec3
 * Minimal interoperable interface to Vector3 in Three.js and Babylon.js
 */
class Vector3 {
    constructor(x = 0, y = 0, z = 0) {
        this.vec3 = fromValues$2(x, y, z);
        this.tempVec3 = create$4();
    }
    get x() {
        return this.vec3[0];
    }
    set x(value) {
        this.vec3[0] = value;
    }
    get y() {
        return this.vec3[1];
    }
    set y(value) {
        this.vec3[1] = value;
    }
    get z() {
        return this.vec3[2];
    }
    set z(value) {
        this.vec3[2] = value;
    }
    set(x, y, z) {
        set$2(this.vec3, x, y, z);
        return this;
    }
    clone() {
        return new Vector3(this.x, this.y, this.z);
    }
    copy(v) {
        this.x = v.x;
        this.y = v.y;
        this.z = v.z;
        return this;
    }
    round() {
        this.x = Math.round(this.x);
        this.y = Math.round(this.y);
        this.z = Math.round(this.z);
        return this;
    }
    normalize() {
        copy$2(this.tempVec3, this.vec3);
        normalize$2(this.vec3, this.tempVec3);
        return this;
    }
    add(v) {
        copy$2(this.tempVec3, this.vec3);
        add(this.vec3, this.tempVec3, v.vec3);
        return this;
    }
    applyQuaternion(q) {
        copy$2(this.tempVec3, this.vec3);
        transformQuat(this.vec3, this.tempVec3, q.quat);
        return this;
    }
}
/**
 * Wrapper class for gl-matrix quat4
 * Minimal interoperable interface to Vector3 in Three.js and Babylon.js
 */
class Quaternion {
    constructor(x = 0, y = 0, z = 0, w = 1) {
        this.quat = fromValues(x, y, z, w);
        this.tempQuat = create$2();
    }
    get x() {
        return this.quat[0];
    }
    set x(value) {
        this.quat[0] = value;
    }
    get y() {
        return this.quat[1];
    }
    set y(value) {
        this.quat[1] = value;
    }
    get z() {
        return this.quat[2];
    }
    set z(value) {
        this.quat[2] = value;
    }
    get w() {
        return this.quat[3];
    }
    set w(value) {
        this.quat[3] = value;
    }
    set(x, y, z, w) {
        set(this.quat, x, y, z, w);
        return this;
    }
    clone() {
        return new Quaternion(this.x, this.y, this.z, this.w);
    }
    copy(q) {
        set(this.quat, q.x, q.y, q.z, q.w);
        return this;
    }
    normalize() {
        copy(this.tempQuat, this.quat);
        normalize(this.quat, this.tempQuat);
        return this;
    }
    invert() {
        copy(this.tempQuat, this.quat);
        conjugate(this.quat, this.tempQuat);
        return this;
    }
    multiply(q) {
        copy(this.tempQuat, this.quat);
        multiply$1(this.quat, this.tempQuat, q.quat);
        return this;
    }
    setFromAxisAngle(axis, angle) {
        setAxisAngle(this.quat, axis.vec3, angle);
        return this;
    }
}

/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
/**
 * Convert a Vector3-like object to a plain Vec3 object
 */
function vec3ToObj(v) {
    return { x: v.x, y: v.y, z: v.z };
}
/**
 * Convert a Quaternion-like object to a plain Quat object
 */
function quatToObj(q) {
    return { x: q.x, y: q.y, z: q.z, w: q.w };
}
/**
 * Convert quaternion to euler angles (in degrees)
 * Uses YXZ order (yaw-pitch-roll) which is standard for XR:
 * - Yaw: rotation around Y axis (turning left/right)
 * - Pitch: rotation around X axis (looking up/down)
 * - Roll: rotation around Z axis (tilting head)
 */
function quatToEuler(q) {
    const { x, y, z, w } = q;
    const RAD_TO_DEG = 180 / Math.PI;
    // YXZ order
    const sinp = Math.max(-1, Math.min(1, 2 * (w * x - y * z)));
    let pitch;
    if (Math.abs(sinp) >= 1) {
        pitch = (Math.sign(sinp) * Math.PI) / 2;
    }
    else {
        pitch = Math.asin(sinp);
    }
    const siny_cosp = 2 * (w * y + x * z);
    const cosy_cosp = 1 - 2 * (x * x + y * y);
    const yaw = Math.atan2(siny_cosp, cosy_cosp);
    const sinr_cosp = 2 * (w * z + x * y);
    const cosr_cosp = 1 - 2 * (x * x + z * z);
    const roll = Math.atan2(sinr_cosp, cosr_cosp);
    return {
        pitch: pitch * RAD_TO_DEG,
        yaw: yaw * RAD_TO_DEG,
        roll: roll * RAD_TO_DEG,
    };
}
/**
 * Convert euler angles (in degrees) to quaternion
 * Uses YXZ order (yaw-pitch-roll) which is standard for XR:
 * - Yaw: rotation around Y axis (turning left/right)
 * - Pitch: rotation around X axis (looking up/down)
 * - Roll: rotation around Z axis (tilting head)
 * Missing angles default to 0.
 */
function eulerToQuat(euler) {
    var _a, _b, _c;
    const DEG_TO_RAD = Math.PI / 180;
    const pitch = ((_a = euler.pitch) !== null && _a !== void 0 ? _a : 0) * DEG_TO_RAD; // X-axis
    const yaw = ((_b = euler.yaw) !== null && _b !== void 0 ? _b : 0) * DEG_TO_RAD; // Y-axis
    const roll = ((_c = euler.roll) !== null && _c !== void 0 ? _c : 0) * DEG_TO_RAD; // Z-axis
    // Half angles
    const cx = Math.cos(pitch * 0.5);
    const sx = Math.sin(pitch * 0.5);
    const cy = Math.cos(yaw * 0.5);
    const sy = Math.sin(yaw * 0.5);
    const cz = Math.cos(roll * 0.5);
    const sz = Math.sin(roll * 0.5);
    // YXZ order: first yaw, then pitch, then roll
    return {
        w: cx * cy * cz + sx * sy * sz,
        x: sx * cy * cz + cx * sy * sz,
        y: cx * sy * cz - sx * cy * sz,
        z: cx * cy * sz - sx * sy * cz,
    };
}
/**
 * Calculate normalized direction vector from one point to another
 * Returns default forward direction (0, 0, -1) if points are coincident
 */
function directionTo(from, to) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dz = to.z - from.z;
    const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (length === 0) {
        return { x: 0, y: 0, z: -1 }; // Default forward (WebXR convention)
    }
    return {
        x: dx / length,
        y: dy / length,
        z: dz / length,
    };
}
/**
 * Calculate gimbal-style look rotation (yaw + pitch only, roll = 0)
 * This keeps the camera/headset level while looking at a target.
 * @param direction - The direction to look towards
 * @returns Quaternion with only yaw and pitch, no roll
 */
function lookRotationGimbal(direction) {
    // Calculate horizontal distance
    const horizontalDist = Math.sqrt(direction.x * direction.x + direction.z * direction.z);
    // Calculate yaw: rotation around Y axis to face target horizontally
    // atan2(-z, -x) gives angle from negative Z axis (forward in WebXR)
    // We use -z, x to match WebXR's -Z forward convention
    let yaw = 0;
    if (horizontalDist > 0.0001) {
        yaw = Math.atan2(-direction.x, -direction.z);
    }
    // Calculate pitch: rotation around X axis to look up/down
    // Positive direction.y (target above) = positive pitch (look up)
    // Negative direction.y (target below) = negative pitch (look down)
    const pitch = Math.atan2(direction.y, horizontalDist);
    // Build the quaternion directly from radians (roll = 0). This matches
    // eulerToQuat's YXZ formulas with cz = 1, sz = 0, avoiding the
    // radians -> degrees -> radians round trip.
    const cx = Math.cos(pitch * 0.5);
    const sx = Math.sin(pitch * 0.5);
    const cy = Math.cos(yaw * 0.5);
    const sy = Math.sin(yaw * 0.5);
    return {
        w: cx * cy,
        x: sx * cy,
        y: cx * sy,
        z: -sx * sy,
    };
}
/**
 * Calculate quaternion that looks from origin towards a direction
 * @param direction - The direction to look towards (will be normalized)
 * @param up - The up vector (default: world up Y-axis)
 */
function lookRotation(direction, up = { x: 0, y: 1, z: 0 }) {
    // Normalize direction
    const dirLen = Math.sqrt(direction.x * direction.x +
        direction.y * direction.y +
        direction.z * direction.z);
    if (dirLen === 0) {
        return { x: 0, y: 0, z: 0, w: 1 }; // Identity quaternion
    }
    const forward = {
        x: direction.x / dirLen,
        y: direction.y / dirLen,
        z: direction.z / dirLen,
    };
    // Calculate right vector (cross product of forward and up, NOT up and forward)
    // forward × up gives correct right-hand orientation
    const right = {
        x: forward.y * up.z - forward.z * up.y,
        y: forward.z * up.x - forward.x * up.z,
        z: forward.x * up.y - forward.y * up.x,
    };
    const rightLen = Math.sqrt(right.x * right.x + right.y * right.y + right.z * right.z);
    if (rightLen === 0) {
        // Direction is parallel to up, choose a different up
        const altUp = { x: 1, y: 0, z: 0 };
        right.x = forward.y * altUp.z - forward.z * altUp.y;
        right.y = forward.z * altUp.x - forward.x * altUp.z;
        right.z = forward.x * altUp.y - forward.y * altUp.x;
        const altRightLen = Math.sqrt(right.x * right.x + right.y * right.y + right.z * right.z);
        right.x /= altRightLen;
        right.y /= altRightLen;
        right.z /= altRightLen;
    }
    else {
        right.x /= rightLen;
        right.y /= rightLen;
        right.z /= rightLen;
    }
    // Recalculate up (cross product of right and forward for proper orientation)
    const newUp = {
        x: right.y * forward.z - right.z * forward.y,
        y: right.z * forward.x - right.x * forward.z,
        z: right.x * forward.y - right.y * forward.x,
    };
    // Build rotation matrix and convert to quaternion
    // Matrix: [right, newUp, -forward] (column vectors)
    const m00 = right.x, m01 = newUp.x, m02 = -forward.x;
    const m10 = right.y, m11 = newUp.y, m12 = -forward.y;
    const m20 = right.z, m21 = newUp.z, m22 = -forward.z;
    const trace = m00 + m11 + m22;
    let qw, qx, qy, qz;
    if (trace > 0) {
        const s = 0.5 / Math.sqrt(trace + 1.0);
        qw = 0.25 / s;
        qx = (m21 - m12) * s;
        qy = (m02 - m20) * s;
        qz = (m10 - m01) * s;
    }
    else if (m00 > m11 && m00 > m22) {
        const s = 2.0 * Math.sqrt(1.0 + m00 - m11 - m22);
        qw = (m21 - m12) / s;
        qx = 0.25 * s;
        qy = (m01 + m10) / s;
        qz = (m02 + m20) / s;
    }
    else if (m11 > m22) {
        const s = 2.0 * Math.sqrt(1.0 + m11 - m00 - m22);
        qw = (m02 - m20) / s;
        qx = (m01 + m10) / s;
        qy = 0.25 * s;
        qz = (m12 + m21) / s;
    }
    else {
        const s = 2.0 * Math.sqrt(1.0 + m22 - m00 - m11);
        qw = (m10 - m01) / s;
        qx = (m02 + m20) / s;
        qy = (m12 + m21) / s;
        qz = 0.25 * s;
    }
    // Normalize the quaternion to ensure unit length
    const len = Math.sqrt(qx * qx + qy * qy + qz * qz + qw * qw);
    if (len > 0) {
        qx /= len;
        qy /= len;
        qz /= len;
        qw /= len;
    }
    return { x: qx, y: qy, z: qz, w: qw };
}
/**
 * Wait for a condition to become true, checking each animation frame
 */
function waitForCondition(condition, timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
        const startTime = Date.now();
        const check = () => {
            if (condition()) {
                resolve();
            }
            else if (Date.now() - startTime > timeoutMs) {
                reject(new Error('Timeout waiting for condition'));
            }
            else {
                requestAnimationFrame(check);
            }
        };
        check();
    });
}

/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
/**
 * Check if an orientation input is euler angles (has any of pitch, yaw, or roll)
 */
function isEulerRotation(orientation) {
    return ('pitch' in orientation || 'yaw' in orientation || 'roll' in orientation);
}
/**
 * Normalize an orientation input to a quaternion
 */
function normalizeOrientation(orientation) {
    if (isEulerRotation(orientation)) {
        return eulerToQuat(orientation);
    }
    return orientation;
}
/**
 * Linear interpolation for numbers
 */
function lerp(a, b, t) {
    return a + (b - a) * t;
}
/**
 * Linear interpolation for Vec3
 */
function lerpVec3(a, b, t) {
    return {
        x: lerp(a.x, b.x, t),
        y: lerp(a.y, b.y, t),
        z: lerp(a.z, b.z, t),
    };
}
/**
 * Spherical linear interpolation for quaternions
 */
function slerpQuat(a, b, t) {
    // Compute dot product
    let dot = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;
    // If dot is negative, negate one quaternion to take shorter path
    let bx = b.x, by = b.y, bz = b.z, bw = b.w;
    if (dot < 0) {
        dot = -dot;
        bx = -bx;
        by = -by;
        bz = -bz;
        bw = -bw;
    }
    // If quaternions are very close, use linear interpolation
    if (dot > 0.9995) {
        const result = {
            x: lerp(a.x, bx, t),
            y: lerp(a.y, by, t),
            z: lerp(a.z, bz, t),
            w: lerp(a.w, bw, t),
        };
        // Normalize
        const len = Math.sqrt(result.x * result.x +
            result.y * result.y +
            result.z * result.z +
            result.w * result.w);
        return {
            x: result.x / len,
            y: result.y / len,
            z: result.z / len,
            w: result.w / len,
        };
    }
    // Standard slerp
    const theta0 = Math.acos(dot);
    const theta = theta0 * t;
    const sinTheta = Math.sin(theta);
    const sinTheta0 = Math.sin(theta0);
    const s0 = Math.cos(theta) - (dot * sinTheta) / sinTheta0;
    const s1 = sinTheta / sinTheta0;
    return {
        x: s0 * a.x + s1 * bx,
        y: s0 * a.y + s1 * by,
        z: s0 * a.z + s1 * bz,
        w: s0 * a.w + s1 * bw,
    };
}
/**
 * Map of common device name aliases to canonical DeviceId values.
 * Enables callers to use natural variants like "right", "left-controller",
 * "controllers.right", etc. in addition to the canonical names.
 */
const DEVICE_ID_ALIASES = {
    right: 'controller-right',
    left: 'controller-left',
    'right-controller': 'controller-right',
    'left-controller': 'controller-left',
    'controllers.right': 'controller-right',
    'controllers.left': 'controller-left',
    rightController: 'controller-right',
    leftController: 'controller-left',
    'right-hand': 'hand-right',
    'left-hand': 'hand-left',
    'hands.right': 'hand-right',
    'hands.left': 'hand-left',
    rightHand: 'hand-right',
    leftHand: 'hand-left',
};
/**
 * Resolve a device identifier, accepting both canonical names and common aliases.
 */
function resolveDeviceId(id) {
    var _a;
    return (_a = DEVICE_ID_ALIASES[id]) !== null && _a !== void 0 ? _a : id;
}
/** Default duration (seconds) for the high-level `select` action. */
const DEFAULT_SELECT_DURATION_S = 0.15;
function requireSelectableDeviceId(value) {
    switch (value) {
        case 'controller-left':
        case 'controller-right':
        case 'hand-left':
        case 'hand-right':
            return value;
        default:
            throw new Error(`Unsupported select device: ${String(value)}`);
    }
}
const gazeWorldOrientation = create$2();
const gazeViewerInverse = create$2();
const gazeLocalOrientation = create$2();
function isFiniteNumber(n) {
    return typeof n === 'number' && Number.isFinite(n);
}
function clamp$1(value, min, max) {
    return Math.min(max, Math.max(min, value));
}
/**
 * Validate a position, throwing on any non-finite component so a bad input
 * cannot permanently corrupt the device pose.
 */
function validatePosition(p) {
    if (!isFiniteNumber(p.x) || !isFiniteNumber(p.y) || !isFiniteNumber(p.z)) {
        throw new Error(`Invalid position: x, y, z must be finite numbers (got ${JSON.stringify(p)}).`);
    }
}
/**
 * Validate a quaternion and return a normalized copy. Throws on non-finite
 * components or a near-zero-length quaternion.
 */
function validateAndNormalizeQuat(q) {
    if (!isFiniteNumber(q.x) ||
        !isFiniteNumber(q.y) ||
        !isFiniteNumber(q.z) ||
        !isFiniteNumber(q.w)) {
        throw new Error(`Invalid orientation: x, y, z, w must be finite numbers (got ${JSON.stringify(q)}).`);
    }
    const len = Math.sqrt(q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w);
    if (len < 1e-6) {
        throw new Error('Invalid orientation: quaternion has near-zero length.');
    }
    return { x: q.x / len, y: q.y / len, z: q.z / len, w: q.w / len };
}
/**
 * RemoteControlInterface provides frame-synchronized programmatic control of an XRDevice.
 *
 * This class implements a command queue that processes actions during each frame update,
 * enabling smooth animations and coordinated control with DevUI.
 *
 * Key features:
 * - Frame-synchronized execution: Commands are queued and processed during frame update
 * - Duration-based actions: Smooth animations via lerp over multiple frames
 * - Automatic capture/release: Captures device on first command, releases 30s after queue empties
 * - Unified device identifiers: 'headset', 'controller-left', 'hand-right', etc.
 *
 * Usage:
 * ```typescript
 * import { XRDevice, metaQuest3 } from 'iwer';
 *
 * const device = new XRDevice(metaQuest3);
 * device.installRuntime();
 *
 * // Get transform
 * const result = await device.remote.dispatch('get_transform', { device: 'headset' });
 *
 * // Animate headset to new position over 1 second
 * await device.remote.dispatch('animate_to', {
 *   device: 'headset',
 *   position: { x: 0, y: 1.6, z: -1 },
 *   duration: 1.0
 * });
 * ```
 */
class RemoteControlInterface {
    constructor(device) {
        this.commandQueue = [];
        this._isCaptured = false;
        this.releaseTimer = null;
        this.actionIdCounter = 0;
        /** Release timeout in milliseconds (default: 30000 = 30 seconds) */
        this.RELEASE_TIMEOUT_MS = 30000;
        /**
         * Per-action timeout in milliseconds. A queued action is rejected if no frame
         * advances the queue within this window (plus the action's own duration), so
         * callers don't hang forever when the XR render loop is paused or throttled.
         */
        this.ACTION_TIMEOUT_MS = 10000;
        this.actionTimers = new WeakMap();
        this.device = device;
    }
    generateActionId() {
        return `action_${++this.actionIdCounter}`;
    }
    // =============================================================================
    // Public Properties
    // =============================================================================
    /**
     * Whether the device is currently captured for programmatic control.
     * When true, DevUI should go into passive mode (sync FROM device only).
     */
    get isCaptured() {
        return this._isCaptured;
    }
    /**
     * Number of pending actions in the queue
     */
    get queueLength() {
        return this.commandQueue.length;
    }
    // =============================================================================
    // Queue Management
    // =============================================================================
    /**
     * Enqueue a discrete action for processing
     */
    enqueueDiscrete(method, params) {
        return new Promise((resolve, reject) => {
            const action = {
                type: 'discrete',
                id: this.generateActionId(),
                method,
                params,
                resolve,
                reject,
            };
            this.commandQueue.push(action);
            this.armActionTimeout(action, method);
        });
    }
    /**
     * Enqueue a duration action for processing
     */
    enqueueDuration(method, params, durationMs, startState, targetState) {
        return new Promise((resolve, reject) => {
            const action = {
                type: 'duration',
                id: this.generateActionId(),
                method,
                params,
                durationMs,
                elapsedMs: 0,
                startState,
                targetState,
                resolve,
                reject,
            };
            this.commandQueue.push(action);
            // Give duration actions their full runtime plus the standard grace window.
            this.armActionTimeout(action, method, durationMs);
        });
    }
    /**
     * Arm a timeout that rejects and removes a queued action if no frame processes
     * it in time. Without this, a state-mutating dispatch hangs forever when the
     * render loop that drives update() is paused.
     */
    armActionTimeout(action, method, extraMs = 0) {
        const timeoutMs = this.ACTION_TIMEOUT_MS + extraMs;
        const timer = setTimeout(() => {
            const index = this.commandQueue.indexOf(action);
            if (index === -1) {
                return;
            }
            this.commandQueue.splice(index, 1);
            this.actionTimers.delete(action);
            action.reject(new Error(`RemoteControlInterface: action '${method}' timed out after ` +
                `${timeoutMs}ms with no frame processing the queue ` +
                `(is the XR render loop running?).`));
        }, timeoutMs);
        this.actionTimers.set(action, timer);
    }
    /** Clear a queued action's timeout once it has been settled. */
    clearActionTimeout(action) {
        const timer = this.actionTimers.get(action);
        if (timer !== undefined) {
            clearTimeout(timer);
            this.actionTimers.delete(action);
        }
    }
    /**
     * Update method called each frame by XRDevice.
     * Processes the command queue and handles duration-based animations.
     *
     * @param deltaTimeMs - Time since last frame in milliseconds
     */
    update(deltaTimeMs) {
        if (this.commandQueue.length === 0) {
            return;
        }
        // Always cancel pending release while queue is active
        this.cancelReleaseTimer();
        // Activate capture mode
        if (!this._isCaptured) {
            this._isCaptured = true;
            this.device.controlMode = 'programmatic';
        }
        while (this.commandQueue.length > 0) {
            const action = this.commandQueue[0];
            if (action.type === 'discrete') {
                // Execute discrete action immediately
                try {
                    const result = this.executeDiscreteAction(action);
                    action.resolve(result);
                }
                catch (error) {
                    action.reject(error);
                }
                this.clearActionTimeout(action);
                this.commandQueue.shift();
                // Continue to next action
            }
            else {
                // Duration action - lerp by delta time
                action.elapsedMs += deltaTimeMs;
                if (action.elapsedMs >= action.durationMs) {
                    // Complete - apply final state
                    try {
                        this.applyDurationFinalState(action);
                        action.resolve(this.getDurationResult(action));
                    }
                    catch (error) {
                        action.reject(error);
                    }
                    this.clearActionTimeout(action);
                    this.commandQueue.shift();
                    // Continue to next action
                }
                else {
                    // In progress - lerp
                    try {
                        const t = action.elapsedMs / action.durationMs;
                        this.applyDurationLerpState(action, t);
                    }
                    catch (error) {
                        action.reject(error);
                        this.clearActionTimeout(action);
                        this.commandQueue.shift();
                        continue;
                    }
                    // Stop processing - wait for next frame
                    break;
                }
            }
        }
        // Notify state change
        this.device.notifyStateChange();
        // Start release timer if queue is empty
        if (this.commandQueue.length === 0) {
            this.startReleaseTimer();
        }
    }
    startReleaseTimer() {
        this.cancelReleaseTimer();
        this.releaseTimer = setTimeout(() => {
            this._isCaptured = false;
            this.device.controlMode = 'manual';
            this.releaseTimer = null;
        }, this.RELEASE_TIMEOUT_MS);
    }
    cancelReleaseTimer() {
        if (this.releaseTimer !== null) {
            clearTimeout(this.releaseTimer);
            this.releaseTimer = null;
        }
    }
    // =============================================================================
    // Device Resolution
    // =============================================================================
    /**
     * Get the transform (position, quaternion) for a device
     */
    getDeviceTransform(deviceId) {
        switch (deviceId) {
            case 'headset':
                return {
                    position: vec3ToObj(this.device.position),
                    orientation: quatToObj(this.device.quaternion),
                };
            case 'controller-left': {
                const controller = this.device.controllers.left;
                if (!controller)
                    throw new Error('Left controller not available');
                return {
                    position: vec3ToObj(controller.position),
                    orientation: quatToObj(controller.quaternion),
                };
            }
            case 'controller-right': {
                const controller = this.device.controllers.right;
                if (!controller)
                    throw new Error('Right controller not available');
                return {
                    position: vec3ToObj(controller.position),
                    orientation: quatToObj(controller.quaternion),
                };
            }
            case 'hand-left': {
                const hand = this.device.hands.left;
                if (!hand)
                    throw new Error('Left hand not available');
                return {
                    position: vec3ToObj(hand.position),
                    orientation: quatToObj(hand.quaternion),
                };
            }
            case 'hand-right': {
                const hand = this.device.hands.right;
                if (!hand)
                    throw new Error('Right hand not available');
                return {
                    position: vec3ToObj(hand.position),
                    orientation: quatToObj(hand.quaternion),
                };
            }
            case 'gaze': {
                const gaze = this.device.gaze;
                if (!gaze)
                    throw new Error('Gaze input not available');
                multiply$1(gazeWorldOrientation, this.device.quaternion.quat, gaze.quaternion.quat);
                return {
                    position: vec3ToObj(this.device.position),
                    orientation: {
                        x: gazeWorldOrientation[0],
                        y: gazeWorldOrientation[1],
                        z: gazeWorldOrientation[2],
                        w: gazeWorldOrientation[3],
                    },
                };
            }
            default:
                throw new Error(`Unknown device: ${deviceId}`);
        }
    }
    /**
     * Set the transform for a device
     */
    setDeviceTransform(deviceId, position, orientation) {
        // Validate both inputs before applying either, so an invalid orientation
        // can't leave a half-applied (position-only) and permanently corrupt pose.
        if (deviceId === 'gaze' && position) {
            throw new Error('Gaze position is derived from the headset. Move the headset transform instead.');
        }
        if (position) {
            validatePosition(position);
        }
        const orient = orientation
            ? validateAndNormalizeQuat(orientation)
            : undefined;
        switch (deviceId) {
            case 'headset':
                if (position) {
                    this.device.position.set(position.x, position.y, position.z);
                }
                if (orient) {
                    this.device.quaternion.set(orient.x, orient.y, orient.z, orient.w);
                }
                break;
            case 'controller-left': {
                const controller = this.device.controllers.left;
                if (!controller)
                    throw new Error('Left controller not available');
                if (position) {
                    controller.position.set(position.x, position.y, position.z);
                }
                if (orient) {
                    controller.quaternion.set(orient.x, orient.y, orient.z, orient.w);
                }
                break;
            }
            case 'controller-right': {
                const controller = this.device.controllers.right;
                if (!controller)
                    throw new Error('Right controller not available');
                if (position) {
                    controller.position.set(position.x, position.y, position.z);
                }
                if (orient) {
                    controller.quaternion.set(orient.x, orient.y, orient.z, orient.w);
                }
                break;
            }
            case 'hand-left': {
                const hand = this.device.hands.left;
                if (!hand)
                    throw new Error('Left hand not available');
                if (position) {
                    hand.position.set(position.x, position.y, position.z);
                }
                if (orient) {
                    hand.quaternion.set(orient.x, orient.y, orient.z, orient.w);
                }
                break;
            }
            case 'hand-right': {
                const hand = this.device.hands.right;
                if (!hand)
                    throw new Error('Right hand not available');
                if (position) {
                    hand.position.set(position.x, position.y, position.z);
                }
                if (orient) {
                    hand.quaternion.set(orient.x, orient.y, orient.z, orient.w);
                }
                break;
            }
            case 'gaze': {
                const gaze = this.device.gaze;
                if (!gaze)
                    throw new Error('Gaze input not available');
                if (orient) {
                    invert(gazeViewerInverse, this.device.quaternion.quat);
                    set(gazeWorldOrientation, orient.x, orient.y, orient.z, orient.w);
                    multiply$1(gazeLocalOrientation, gazeViewerInverse, gazeWorldOrientation);
                    gaze.quaternion.set(gazeLocalOrientation[0], gazeLocalOrientation[1], gazeLocalOrientation[2], gazeLocalOrientation[3]);
                }
                break;
            }
            default:
                throw new Error(`Unknown device: ${deviceId}`);
        }
    }
    /**
     * Transform a position from XR-origin-relative coordinates to GlobalSpace.
     * The XR origin is defined by the first reference space requested by the app.
     * This is necessary because device positions are in GlobalSpace, but positions
     * from get_object_transform are relative to the XR origin.
     */
    transformXROriginToGlobal(position) {
        const session = this.device[P_DEVICE].runtime.getSession();
        if (!session) {
            return position;
        }
        const offsetMatrix = session.originOffsetMatrix;
        if (!offsetMatrix) {
            return position;
        }
        // Transform position from XR-origin space to GlobalSpace
        const posVec = fromValues$2(position.x, position.y, position.z);
        transformMat4$1(posVec, posVec, offsetMatrix);
        return {
            x: posVec[0],
            y: posVec[1],
            z: posVec[2],
        };
    }
    /**
     * Get the select value for an input device (trigger for controller, pinch for hand)
     */
    getDeviceSelectValue(deviceId) {
        var _a, _b, _c, _d, _e, _f, _g, _h;
        switch (deviceId) {
            case 'controller-left':
                return (_b = (_a = this.device.controllers.left) === null || _a === void 0 ? void 0 : _a.getButtonValue('trigger')) !== null && _b !== void 0 ? _b : 0;
            case 'controller-right':
                return (_d = (_c = this.device.controllers.right) === null || _c === void 0 ? void 0 : _c.getButtonValue('trigger')) !== null && _d !== void 0 ? _d : 0;
            case 'hand-left':
                return (_f = (_e = this.device.hands.left) === null || _e === void 0 ? void 0 : _e.pinchValue) !== null && _f !== void 0 ? _f : 0;
            case 'hand-right':
                return (_h = (_g = this.device.hands.right) === null || _g === void 0 ? void 0 : _g.pinchValue) !== null && _h !== void 0 ? _h : 0;
            default:
                throw new Error(`Unknown input device: ${deviceId}`);
        }
    }
    /**
     * Set the select value for an input device
     */
    setDeviceSelectValue(deviceId, value) {
        var _a, _b, _c, _d;
        switch (deviceId) {
            case 'controller-left':
                (_a = this.device.controllers.left) === null || _a === void 0 ? void 0 : _a.updateButtonValue('trigger', value);
                break;
            case 'controller-right':
                (_b = this.device.controllers.right) === null || _b === void 0 ? void 0 : _b.updateButtonValue('trigger', value);
                break;
            case 'hand-left':
                (_c = this.device.hands.left) === null || _c === void 0 ? void 0 : _c.updatePinchValue(value);
                break;
            case 'hand-right':
                (_d = this.device.hands.right) === null || _d === void 0 ? void 0 : _d.updatePinchValue(value);
                break;
            default:
                throw new Error(`Unknown input device: ${deviceId}`);
        }
    }
    /**
     * Set connected state for an input device
     */
    setDeviceConnected(deviceId, connected) {
        switch (deviceId) {
            case 'controller-left':
                if (this.device.controllers.left) {
                    this.device.controllers.left.connected = connected;
                }
                break;
            case 'controller-right':
                if (this.device.controllers.right) {
                    this.device.controllers.right.connected = connected;
                }
                break;
            case 'hand-left':
                if (this.device.hands.left) {
                    this.device.hands.left.connected = connected;
                }
                break;
            case 'hand-right':
                if (this.device.hands.right) {
                    this.device.hands.right.connected = connected;
                }
                break;
            case 'gaze':
                if (!this.device.gaze) {
                    throw new Error('Gaze input not available');
                }
                this.device.gaze.connected = connected;
                break;
            default:
                throw new Error(`Unknown input device: ${deviceId}`);
        }
    }
    // =============================================================================
    // Discrete Action Execution
    // =============================================================================
    executeDiscreteAction(action) {
        const { method, params } = action;
        switch (method) {
            // Session tools
            case 'get_session_status':
                return this.executeGetSessionStatus();
            case 'accept_session':
                return this.executeAcceptSession();
            case 'end_session':
                return this.executeEndSession();
            // Transform tools
            case 'get_transform':
                return this.executeGetTransform(params);
            case 'set_transform':
                return this.executeSetTransform(params);
            case 'look_at':
                return this.executeLookAt(params);
            // Input tools
            case 'set_input_mode':
                return this.executeSetInputMode(params);
            case 'set_connected':
                return this.executeSetConnected(params);
            case 'get_select_value':
                return this.executeGetSelectValue(params);
            case 'set_select_value':
                return this.executeSetSelectValue(params);
            case 'set_hand_pose':
                return this.executeSetHandPose(params);
            // Gamepad tools
            case 'get_gamepad_state':
                return this.executeGetGamepadState(params);
            case 'set_gamepad_state':
                return this.executeSetGamepadState(params);
            // State tools
            case 'get_device_state':
                return this.executeGetDeviceState();
            case 'set_device_state':
                return this.executeSetDeviceState(params);
            // Internal select sequence actions
            case '_select_press': {
                const deviceId = requireSelectableDeviceId(params.device);
                this.setDeviceSelectValue(deviceId, 1);
                return undefined;
            }
            case '_select_release': {
                const deviceId = requireSelectableDeviceId(params.device);
                this.setDeviceSelectValue(deviceId, 0);
                return undefined;
            }
            default:
                throw new Error(`Unknown method: ${method}`);
        }
    }
    // =============================================================================
    // Session Tool Implementations
    // =============================================================================
    executeGetSessionStatus() {
        var _a, _b;
        const runtime = this.device[P_DEVICE].runtime;
        const session = runtime.getSession();
        return {
            deviceName: this.device.name,
            isRuntimeInstalled: true,
            sessionActive: !!session,
            sessionOffered: runtime.kind === 'emulated' && this.device.sessionOffered,
            sessionMode: (_a = session === null || session === void 0 ? void 0 : session.mode) !== null && _a !== void 0 ? _a : null,
            enabledFeatures: session ? Array.from(session.enabledFeatures) : [],
            visibilityState: (_b = session === null || session === void 0 ? void 0 : session.visibilityState) !== null && _b !== void 0 ? _b : this.device.visibilityState,
            runtimeKind: runtime.kind,
        };
    }
    executeAcceptSession() {
        if (this.device[P_DEVICE].runtime.kind === 'native') {
            throw new Error('Session start is app-driven in native override mode; immersive sessions require a user gesture.');
        }
        if (!this.device.sessionOffered) {
            throw new Error('No session has been offered');
        }
        this.device.grantOfferedSession();
        // Session activation is async - caller should use get_session_status to poll
        return { success: true };
    }
    executeEndSession() {
        const session = this.device[P_DEVICE].runtime.getSession();
        if (!session) {
            throw new Error('No active session');
        }
        session.end();
        return { success: true };
    }
    // =============================================================================
    // Transform Tool Implementations
    // =============================================================================
    executeGetTransform(params) {
        const { device: deviceId } = params;
        const transform = this.getDeviceTransform(deviceId);
        return {
            device: deviceId,
            position: transform.position,
            orientation: transform.orientation,
            euler: quatToEuler(transform.orientation),
        };
    }
    executeSetTransform(params) {
        const { device: deviceId, position, orientation } = params;
        const targetOrientation = orientation
            ? normalizeOrientation(orientation)
            : undefined;
        this.setDeviceTransform(deviceId, position, targetOrientation);
        const newTransform = this.getDeviceTransform(deviceId);
        return {
            device: deviceId,
            position: newTransform.position,
            orientation: newTransform.orientation,
        };
    }
    executeLookAt(params) {
        const { device: deviceId, target, moveToDistance } = params;
        if (deviceId === 'gaze' && moveToDistance !== undefined) {
            throw new Error('Gaze origin is derived from the headset; moveToDistance is not supported for gaze.');
        }
        const currentTransform = this.getDeviceTransform(deviceId);
        // Transform target from XR-origin-relative to GlobalSpace
        const targetInGlobal = this.transformXROriginToGlobal(target);
        // Calculate direction to target
        const direction = directionTo(currentTransform.position, targetInGlobal);
        // Calculate look rotation
        // Use gimbal rotation for headset (keeps it level, no roll)
        // Use standard lookRotation for controllers/hands (can tilt freely)
        const lookQuat = deviceId === 'headset'
            ? lookRotationGimbal(direction)
            : lookRotation(direction);
        // Optionally move to a specific distance from target
        let newPosition;
        if (moveToDistance !== undefined) {
            newPosition = {
                x: targetInGlobal.x - direction.x * moveToDistance,
                y: targetInGlobal.y - direction.y * moveToDistance,
                z: targetInGlobal.z - direction.z * moveToDistance,
            };
        }
        this.setDeviceTransform(deviceId, newPosition, lookQuat);
        const newTransform = this.getDeviceTransform(deviceId);
        return {
            device: deviceId,
            position: newTransform.position,
            orientation: newTransform.orientation,
        };
    }
    // =============================================================================
    // Input Tool Implementations
    // =============================================================================
    executeSetInputMode(params) {
        var _a, _b, _c, _d, _e;
        const { mode } = params;
        this.device.primaryInputMode = mode;
        const activeDevices = [];
        if (mode === 'controller') {
            if ((_a = this.device.controllers.left) === null || _a === void 0 ? void 0 : _a.connected) {
                activeDevices.push('controller-left');
            }
            if ((_b = this.device.controllers.right) === null || _b === void 0 ? void 0 : _b.connected) {
                activeDevices.push('controller-right');
            }
        }
        else {
            if ((_c = this.device.hands.left) === null || _c === void 0 ? void 0 : _c.connected) {
                activeDevices.push('hand-left');
            }
            if ((_d = this.device.hands.right) === null || _d === void 0 ? void 0 : _d.connected) {
                activeDevices.push('hand-right');
            }
        }
        if ((_e = this.device.gaze) === null || _e === void 0 ? void 0 : _e.connected) {
            activeDevices.push('gaze');
        }
        return { mode, activeDevices };
    }
    executeSetConnected(params) {
        const { device: deviceId, connected } = params;
        this.setDeviceConnected(deviceId, connected);
        return { device: deviceId, connected };
    }
    executeGetSelectValue(params) {
        const { device: deviceId } = params;
        const value = this.getDeviceSelectValue(deviceId);
        return { device: deviceId, value };
    }
    executeSetSelectValue(params) {
        const { device: deviceId, value } = params;
        this.setDeviceSelectValue(deviceId, value);
        return { device: deviceId, value };
    }
    executeSetHandPose(params) {
        const { device: deviceId, poseId } = params;
        const hand = deviceId === 'hand-left'
            ? 'left'
            : deviceId === 'hand-right'
                ? 'right'
                : null;
        if (!hand) {
            throw new Error(`set_hand_pose requires device 'hand-left' or 'hand-right', got '${deviceId}'.`);
        }
        const handInput = this.device.hands[hand];
        if (!handInput) {
            throw new Error(`Hand ${hand} not available`);
        }
        // poseId is a public, validated setter on XRHandInput.
        handInput.poseId = poseId;
        return { device: deviceId, poseId };
    }
    // =============================================================================
    // World / scene queries (require the synthetic environment module, SEM)
    // =============================================================================
    requireSem() {
        const sem = this.device.sem;
        if (!sem) {
            throw new Error('Scene understanding (SEM) is not installed on this device. ' +
                'Install @iwer/sem to query the emulated world.');
        }
        return sem;
    }
    executeGetObjects() {
        const sem = this.requireSem();
        const objects = [];
        sem.trackedPlanes.forEach((plane) => {
            var _a;
            objects.push({
                type: 'plane',
                semanticLabel: (_a = plane.semanticLabel) !== null && _a !== void 0 ? _a : null,
            });
        });
        sem.trackedMeshes.forEach((mesh) => {
            var _a;
            objects.push({ type: 'mesh', semanticLabel: (_a = mesh.semanticLabel) !== null && _a !== void 0 ? _a : null });
        });
        // NOTE: object poses are intentionally omitted for now — SEM tracks them in
        // GlobalSpace and they need transforming into the app's XR-origin space.
        // Follow-up: add poses + a raycast query once that transform is wired.
        return { objects };
    }
    executeGetWorldState() {
        const sem = this.requireSem();
        return {
            planeCount: sem.trackedPlanes.size,
            meshCount: sem.trackedMeshes.size,
            objects: this.executeGetObjects().objects,
        };
    }
    // =============================================================================
    // Capability discovery & transport
    // =============================================================================
    /**
     * Describe the methods this interface exposes so an agent (or an MCP bridge)
     * can discover capabilities at runtime rather than relying on hard-coded
     * strings. `immediate` methods run synchronously; `requiresSession` methods
     * are queued and need an active, rendering XR session.
     */
    listMethods() {
        const methods = [];
        RemoteControlInterface.IMMEDIATE_METHODS.forEach((method) => {
            methods.push({ method, immediate: true, requiresSession: false });
        });
        RemoteControlInterface.SESSION_REQUIRED_METHODS.forEach((method) => {
            methods.push({ method, immediate: false, requiresSession: true });
        });
        return methods;
    }
    /** Alias for {@link listMethods}; returns the capability manifest. */
    describe() {
        return this.listMethods();
    }
    /**
     * Opt-in transport bridge. Connect a message port (a MessagePort, Worker, or
     * WebSocket-like object) so a remote agent can drive the device by posting
     * `{ id, method, params }` envelopes and receiving `{ id, result }` or
     * `{ id, error }` replies. Kept out of the constructor to preserve the
     * dependency-light, in-process default.
     */
    connectTransport(port) {
        port.addEventListener('message', (event) => {
            const envelope = event.data;
            if (!envelope || typeof envelope.method !== 'string') {
                return;
            }
            const { id, method, params } = envelope;
            this.dispatch(method, params !== null && params !== void 0 ? params : {})
                .then((result) => port.postMessage({ id, result }))
                .catch((error) => port.postMessage({
                id,
                error: error instanceof Error ? error.message : String(error),
            }));
        });
    }
    // =============================================================================
    // Gamepad Tool Implementations
    // =============================================================================
    executeGetGamepadState(params) {
        const { device: deviceId } = params;
        const hand = deviceId === 'controller-left' ? 'left' : 'right';
        const controller = this.device.controllers[hand];
        if (!controller) {
            throw new Error(`Controller ${hand} not available`);
        }
        // Button layout for Meta Quest Touch Plus controllers
        // Use hand-conditional internal names for lookup
        const buttonInternalNames = [
            'trigger',
            'squeeze',
            'thumbstick',
            hand === 'left' ? 'x-button' : 'a-button',
            hand === 'left' ? 'y-button' : 'b-button',
            'thumbrest',
        ];
        const buttons = buttonInternalNames.map((name, index) => ({
            index,
            name: name
                .replace('x-button', 'x')
                .replace('y-button', 'y')
                .replace('a-button', 'a')
                .replace('b-button', 'b'),
            value: controller.getButtonValue(name),
            touched: controller.getButtonTouched(name),
            pressed: controller.getButtonValue(name) > 0.5,
        }));
        const axesData = controller.getAxes();
        const axes = [
            { index: 0, name: 'thumbstick-x', value: axesData.x },
            { index: 1, name: 'thumbstick-y', value: axesData.y },
        ];
        return {
            device: deviceId,
            connected: controller.connected,
            buttons,
            axes,
        };
    }
    executeSetGamepadState(params) {
        const { device: deviceId, buttons, axes } = params;
        const hand = deviceId === 'controller-left' ? 'left' : 'right';
        const controller = this.device.controllers[hand];
        if (!controller) {
            throw new Error(`Controller ${hand} not available`);
        }
        let buttonsSet = 0;
        let axesSet = 0;
        // Button index to name mapping
        const buttonIndexToName = [
            'trigger',
            'squeeze',
            'thumbstick',
            hand === 'left' ? 'x-button' : 'a-button',
            hand === 'left' ? 'y-button' : 'b-button',
            'thumbrest',
        ];
        if (buttons) {
            for (const btn of buttons) {
                const buttonName = buttonIndexToName[btn.index];
                // Only apply (and count) finite values; clamp into the valid [0,1]
                // range so an out-of-range value can't silently no-op yet still count.
                if (buttonName && isFiniteNumber(btn.value)) {
                    // Use updateButtonValue for proper event triggering
                    controller.updateButtonValue(buttonName, clamp$1(btn.value, 0, 1));
                    if (btn.touched !== undefined) {
                        controller.updateButtonTouch(buttonName, btn.touched);
                    }
                    buttonsSet++;
                }
            }
        }
        if (axes) {
            let xValue;
            let yValue;
            for (const axis of axes) {
                if (!isFiniteNumber(axis.value)) {
                    continue;
                }
                if (axis.index === 0) {
                    xValue = clamp$1(axis.value, -1, 1);
                    axesSet++;
                }
                else if (axis.index === 1) {
                    yValue = clamp$1(axis.value, -1, 1);
                    axesSet++;
                }
            }
            if (xValue !== undefined || yValue !== undefined) {
                const currentAxes = controller.getAxes();
                controller.updateAxes('thumbstick', xValue !== null && xValue !== void 0 ? xValue : currentAxes.x, yValue !== null && yValue !== void 0 ? yValue : currentAxes.y);
            }
        }
        return { device: deviceId, buttonsSet, axesSet };
    }
    // =============================================================================
    // State Tool Implementations
    // =============================================================================
    executeGetDeviceState() {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x, _y, _z;
        return {
            headset: {
                position: vec3ToObj(this.device.position),
                orientation: quatToObj(this.device.quaternion),
            },
            inputMode: this.device.primaryInputMode,
            controllers: {
                left: {
                    connected: (_b = (_a = this.device.controllers.left) === null || _a === void 0 ? void 0 : _a.connected) !== null && _b !== void 0 ? _b : false,
                    position: vec3ToObj((_d = (_c = this.device.controllers.left) === null || _c === void 0 ? void 0 : _c.position) !== null && _d !== void 0 ? _d : { x: 0, y: 0, z: 0 }),
                    orientation: quatToObj((_f = (_e = this.device.controllers.left) === null || _e === void 0 ? void 0 : _e.quaternion) !== null && _f !== void 0 ? _f : {
                        x: 0,
                        y: 0,
                        z: 0,
                        w: 1,
                    }),
                },
                right: {
                    connected: (_h = (_g = this.device.controllers.right) === null || _g === void 0 ? void 0 : _g.connected) !== null && _h !== void 0 ? _h : false,
                    position: vec3ToObj((_k = (_j = this.device.controllers.right) === null || _j === void 0 ? void 0 : _j.position) !== null && _k !== void 0 ? _k : { x: 0, y: 0, z: 0 }),
                    orientation: quatToObj((_m = (_l = this.device.controllers.right) === null || _l === void 0 ? void 0 : _l.quaternion) !== null && _m !== void 0 ? _m : {
                        x: 0,
                        y: 0,
                        z: 0,
                        w: 1,
                    }),
                },
            },
            hands: {
                left: {
                    connected: (_p = (_o = this.device.hands.left) === null || _o === void 0 ? void 0 : _o.connected) !== null && _p !== void 0 ? _p : false,
                    position: vec3ToObj((_r = (_q = this.device.hands.left) === null || _q === void 0 ? void 0 : _q.position) !== null && _r !== void 0 ? _r : { x: 0, y: 0, z: 0 }),
                    orientation: quatToObj((_t = (_s = this.device.hands.left) === null || _s === void 0 ? void 0 : _s.quaternion) !== null && _t !== void 0 ? _t : { x: 0, y: 0, z: 0, w: 1 }),
                },
                right: {
                    connected: (_v = (_u = this.device.hands.right) === null || _u === void 0 ? void 0 : _u.connected) !== null && _v !== void 0 ? _v : false,
                    position: vec3ToObj((_x = (_w = this.device.hands.right) === null || _w === void 0 ? void 0 : _w.position) !== null && _x !== void 0 ? _x : { x: 0, y: 0, z: 0 }),
                    orientation: quatToObj((_z = (_y = this.device.hands.right) === null || _y === void 0 ? void 0 : _y.quaternion) !== null && _z !== void 0 ? _z : { x: 0, y: 0, z: 0, w: 1 }),
                },
            },
            ...(this.device.gaze
                ? {
                    gaze: {
                        connected: this.device.gaze.connected,
                        orientation: this.getDeviceTransform('gaze').orientation,
                    },
                }
                : {}),
            stereoEnabled: this.device.stereoEnabled,
            fov: this.device.fovy * (180 / Math.PI), // Convert to degrees
        };
    }
    executeSetDeviceState(params) {
        const { state } = params;
        if (!state) {
            // Reset to initial state
            this.device.position.set(0, 1.6, 0);
            this.device.quaternion.set(0, 0, 0, 1);
            this.device.primaryInputMode = 'controller';
            this.device.stereoEnabled = false;
            // Reset controllers and hands to default positions
            if (this.device.controllers.left) {
                this.device.controllers.left.position.set(-0.2, 1.4, -0.3);
                this.device.controllers.left.quaternion.set(0, 0, 0, 1);
                this.device.controllers.left.connected = true;
            }
            if (this.device.controllers.right) {
                this.device.controllers.right.position.set(0.2, 1.4, -0.3);
                this.device.controllers.right.quaternion.set(0, 0, 0, 1);
                this.device.controllers.right.connected = true;
            }
            if (this.device.hands.left) {
                this.device.hands.left.position.set(-0.15, 1.3, -0.4);
                this.device.hands.left.quaternion.set(0, 0, 0, 1);
                this.device.hands.left.connected = true;
            }
            if (this.device.hands.right) {
                this.device.hands.right.position.set(0.15, 1.3, -0.4);
                this.device.hands.right.quaternion.set(0, 0, 0, 1);
                this.device.hands.right.connected = true;
            }
            if (this.device.gaze) {
                this.device.gaze.quaternion.set(0, 0, 0, 1);
                this.device.gaze.connected = true;
            }
        }
        else {
            // Apply partial state
            if (state.headset) {
                // Validate before applying either component (atomic, no corruption).
                if (state.headset.position) {
                    validatePosition(state.headset.position);
                }
                const headsetOrient = state.headset.orientation
                    ? validateAndNormalizeQuat(state.headset.orientation)
                    : undefined;
                if (state.headset.position) {
                    this.device.position.set(state.headset.position.x, state.headset.position.y, state.headset.position.z);
                }
                if (headsetOrient) {
                    this.device.quaternion.set(headsetOrient.x, headsetOrient.y, headsetOrient.z, headsetOrient.w);
                }
            }
            if (state.inputMode !== undefined) {
                this.device.primaryInputMode = state.inputMode;
            }
            if (state.stereoEnabled !== undefined) {
                this.device.stereoEnabled = state.stereoEnabled;
            }
            if (state.fov !== undefined) {
                this.device.fovy = state.fov * (Math.PI / 180); // Convert to radians
            }
            if (state.controllers) {
                this.applyInputState('controller-left', state.controllers.left);
                this.applyInputState('controller-right', state.controllers.right);
            }
            if (state.hands) {
                this.applyInputState('hand-left', state.hands.left);
                this.applyInputState('hand-right', state.hands.right);
            }
            if (state.gaze) {
                this.applyInputState('gaze', state.gaze);
            }
        }
        return { state: this.executeGetDeviceState() };
    }
    applyInputState(deviceId, state) {
        if (!state)
            return;
        if (state.connected !== undefined) {
            this.setDeviceConnected(deviceId, state.connected);
        }
        if (state.position || state.orientation) {
            this.setDeviceTransform(deviceId, state.position, state.orientation);
        }
    }
    // =============================================================================
    // Duration Action Handling
    // =============================================================================
    applyDurationLerpState(action, t) {
        const { startState, targetState, params } = action;
        const deviceId = params.device;
        let newPosition;
        let newOrientation;
        if (startState.position && targetState.position) {
            newPosition = lerpVec3(startState.position, targetState.position, t);
        }
        if (startState.orientation && targetState.orientation) {
            newOrientation = slerpQuat(startState.orientation, targetState.orientation, t);
        }
        this.setDeviceTransform(deviceId, newPosition, newOrientation);
    }
    applyDurationFinalState(action) {
        const { targetState, params } = action;
        const deviceId = params.device;
        this.setDeviceTransform(deviceId, targetState.position, targetState.orientation);
    }
    getDurationResult(action) {
        const { params, elapsedMs } = action;
        const deviceId = params.device;
        const transform = this.getDeviceTransform(deviceId);
        return {
            device: deviceId,
            position: transform.position,
            orientation: transform.orientation,
            actualDuration: elapsedMs / 1000,
        };
    }
    /**
     * Activate capture mode for programmatic control.
     * Called when active methods are executed.
     */
    activateCaptureMode() {
        if (!this._isCaptured) {
            this._isCaptured = true;
            this.cancelReleaseTimer();
            this.device.controlMode = 'programmatic';
        }
        // Reset the release timer
        this.startReleaseTimer();
    }
    /**
     * Dispatch a method call.
     *
     * Immediate methods (queries, session management) execute synchronously.
     * State-modifying methods require an active session and are queued for frame-synchronized execution.
     *
     * @param method - The method name (e.g., 'get_transform', 'animate_to')
     * @param params - The method parameters
     * @returns Promise that resolves with the method result
     */
    async dispatch(method, params = {}) {
        var _a;
        // Normalize device identifier aliases (e.g. "right" -> "controller-right")
        // into a copy — never mutate the caller's params object (it may be reused,
        // frozen, or aliased onto a queued action).
        const normalizedParams = typeof params.device === 'string'
            ? { ...params, device: resolveDeviceId(params.device) }
            : params;
        // Immediate methods execute synchronously without queue
        if (RemoteControlInterface.IMMEDIATE_METHODS.has(method)) {
            // Active immediate methods trigger capture mode
            if (RemoteControlInterface.ACTIVE_IMMEDIATE_METHODS.has(method)) {
                this.activateCaptureMode();
            }
            return this.executeImmediateMethod(method, normalizedParams);
        }
        // Methods that modify state require an active session
        if (RemoteControlInterface.SESSION_REQUIRED_METHODS.has(method)) {
            if (!this.device[P_DEVICE].runtime.getSession()) {
                const guidance = this.device[P_DEVICE].runtime.kind === 'native'
                    ? 'The application must start its native immersive session first.'
                    : `Use 'get_session_status' to check session state, and 'accept_session' to start a session.`;
                throw new Error(`Cannot execute '${method}': No active XR session. ` + guidance);
            }
        }
        // Handle animate_to specially - it's a duration action
        if (method === 'animate_to') {
            const animateParams = normalizedParams;
            if (animateParams.device === 'gaze' && animateParams.position) {
                throw new Error('Gaze position is derived from the headset. Move the headset transform instead.');
            }
            const currentTransform = this.getDeviceTransform(animateParams.device);
            const durationMs = ((_a = animateParams.duration) !== null && _a !== void 0 ? _a : 0.5) * 1000;
            const targetOrientation = animateParams.orientation
                ? normalizeOrientation(animateParams.orientation)
                : undefined;
            // Transform target position from XR-origin-relative to GlobalSpace
            const targetPosition = animateParams.position
                ? this.transformXROriginToGlobal(animateParams.position)
                : undefined;
            return this.enqueueDuration(method, normalizedParams, durationMs, {
                position: animateParams.position
                    ? currentTransform.position
                    : undefined,
                orientation: targetOrientation
                    ? currentTransform.orientation
                    : undefined,
            }, {
                position: targetPosition,
                orientation: targetOrientation,
            });
        }
        // Handle select specially - it's a discrete action that enqueues multiple sub-actions
        if (method === 'select') {
            const selectParams = normalizedParams;
            return this.executeSelectSequence(selectParams);
        }
        // All other methods are discrete actions that go through the queue
        return this.enqueueDiscrete(method, normalizedParams);
    }
    /**
     * Execute an immediate method synchronously (not queued).
     * Used for queries and session management that must work outside XR frames.
     */
    executeImmediateMethod(method, params) {
        switch (method) {
            case 'get_session_status':
                return this.executeGetSessionStatus();
            case 'accept_session':
                return this.executeAcceptSession();
            case 'end_session':
                return this.executeEndSession();
            case 'get_transform':
                return this.executeGetTransform(params);
            case 'get_select_value':
                return this.executeGetSelectValue(params);
            case 'get_gamepad_state':
                return this.executeGetGamepadState(params);
            case 'get_device_state':
                return this.executeGetDeviceState();
            case 'get_world_state':
                return this.executeGetWorldState();
            case 'get_objects':
                return this.executeGetObjects();
            default:
                throw new Error(`Unknown immediate method: ${method}`);
        }
    }
    /**
     * Execute select action - this directly enqueues the three sub-actions without awaiting
     * The caller's promise resolves when all sub-actions complete
     */
    executeSelectSequence(params) {
        const { device: deviceId, duration = DEFAULT_SELECT_DURATION_S } = params;
        // Validate device upfront to prevent sub-actions from failing in the frame loop
        this.getDeviceSelectValue(deviceId);
        return new Promise((resolve, reject) => {
            // Track completion of all three actions
            let actionsCompleted = 0;
            const totalActions = 3;
            const checkComplete = () => {
                actionsCompleted++;
                if (actionsCompleted === totalActions) {
                    resolve({
                        device: deviceId,
                        duration,
                    });
                }
            };
            // Enqueue: set value to 1
            const action1 = {
                type: 'discrete',
                id: this.generateActionId(),
                method: '_select_press',
                params: { device: deviceId },
                resolve: checkComplete,
                reject,
            };
            // Enqueue: wait for duration
            const action2 = {
                type: 'duration',
                id: this.generateActionId(),
                method: '_select_wait',
                params: { device: deviceId },
                durationMs: duration * 1000,
                elapsedMs: 0,
                startState: {},
                targetState: {},
                resolve: checkComplete,
                reject,
            };
            // Enqueue: set value to 0
            const action3 = {
                type: 'discrete',
                id: this.generateActionId(),
                method: '_select_release',
                params: { device: deviceId },
                resolve: checkComplete,
                reject,
            };
            this.commandQueue.push(action1, action2, action3);
        });
    }
    /**
     * Accept an offered XR session (async wrapper for proper session activation)
     */
    async acceptSession() {
        if (this.device[P_DEVICE].runtime.kind === 'native') {
            throw new Error('Session start is app-driven in native override mode; immersive sessions require a user gesture.');
        }
        if (!this.device.sessionOffered) {
            throw new Error('No session has been offered');
        }
        this.device.grantOfferedSession();
        // Wait for session to become active
        await waitForCondition(() => !!this.device.activeSession, 5000);
        // Just return success - caller can use get_session_status for details
        return { success: true };
    }
    /**
     * Force release capture mode (for testing/cleanup)
     */
    forceRelease() {
        this.cancelReleaseTimer();
        this._isCaptured = false;
        this.device.controlMode = 'manual';
        // Clear pending actions (and their timeout timers)
        for (const action of this.commandQueue) {
            this.clearActionTimeout(action);
            action.reject(new Error('Capture released'));
        }
        this.commandQueue = [];
        // Reset any stuck input values on BOTH controllers and hands so an
        // interrupted select/squeeze/thumbstick (or hand pinch) doesn't stay
        // engaged. Poses are intentionally left where they are.
        for (const hand of ['left', 'right']) {
            const controller = this.device.controllers[hand];
            if (controller) {
                const buttonNames = [
                    'trigger',
                    'squeeze',
                    'thumbstick',
                    'thumbrest',
                    hand === 'left' ? 'x-button' : 'a-button',
                    hand === 'left' ? 'y-button' : 'b-button',
                ];
                for (const name of buttonNames) {
                    controller.updateButtonValue(name, 0);
                }
                controller.updateAxes('thumbstick', 0, 0);
            }
            const handInput = this.device.hands[hand];
            if (handInput) {
                handInput.updatePinchValue(0);
            }
        }
    }
}
// =============================================================================
// Public API - Dispatch
// =============================================================================
/**
 * Set of methods that execute immediately (synchronously) without going through the queue.
 * These are queries and session management commands that need to work outside of XR frames.
 */
RemoteControlInterface.IMMEDIATE_METHODS = new Set([
    // Session management - must work before/after XR session
    'get_session_status',
    'accept_session',
    'end_session',
    // Pure queries - just read current state
    'get_transform',
    'get_select_value',
    'get_gamepad_state',
    'get_device_state',
    // World/scene introspection - reads the synthetic environment (SEM)
    'get_world_state',
    'get_objects',
]);
/**
 * Set of immediate methods that are "active" - they modify state and should trigger capture mode.
 * Passive methods (queries) should NOT trigger capture mode.
 */
RemoteControlInterface.ACTIVE_IMMEDIATE_METHODS = new Set([
    'accept_session',
    'end_session',
]);
/**
 * Set of methods that require an active XR session.
 * These are state-modifying methods that are processed during frame updates.
 */
RemoteControlInterface.SESSION_REQUIRED_METHODS = new Set([
    'set_transform',
    'look_at',
    'animate_to',
    'set_input_mode',
    'set_connected',
    'set_select_value',
    'select',
    'set_gamepad_state',
    'set_device_state',
    'set_hand_pose',
]);

/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
var GamepadMappingType;
(function (GamepadMappingType) {
    GamepadMappingType["None"] = "";
    GamepadMappingType["Standard"] = "standard";
    GamepadMappingType["XRStandard"] = "xr-standard";
})(GamepadMappingType || (GamepadMappingType = {}));
class GamepadButton {
    constructor(type, eventTrigger) {
        this[P_GAMEPAD] = {
            type,
            eventTrigger,
            pressed: false,
            touched: false,
            value: 0,
            lastFrameValue: 0,
            pendingValue: null,
            immediateTransitionFrom: null,
        };
    }
    get pressed() {
        if (this[P_GAMEPAD].type === 'manual') {
            return this[P_GAMEPAD].pressed;
        }
        else {
            return this[P_GAMEPAD].value > 0;
        }
    }
    get touched() {
        if (this[P_GAMEPAD].type === 'manual') {
            return this[P_GAMEPAD].touched;
        }
        else {
            return this[P_GAMEPAD].touched || this.pressed;
        }
    }
    get value() {
        return this[P_GAMEPAD].value;
    }
}
class EmptyGamepadButton {
    constructor() {
        this.pressed = false;
        this.touched = false;
        this.value = 0;
    }
}
class GamepadHapticActuator {
    constructor(type = 'vibration') {
        this[P_GAMEPAD] = {
            type,
            lastPulse: null,
        };
    }
    get type() {
        return this[P_GAMEPAD].type;
    }
    pulse(value, duration) {
        this[P_GAMEPAD].lastPulse = {
            value,
            duration,
            startTime: performance.now(),
        };
        return Promise.resolve(true);
    }
}
class Gamepad {
    constructor(gamepadConfig, id = '', index = -1, numHapticActuators = 0) {
        this[P_GAMEPAD] = {
            id,
            index,
            connected: false,
            timestamp: performance.now(),
            mapping: gamepadConfig.mapping,
            buttonsMap: {},
            buttonsSequence: [],
            axesMap: {},
            axesSequence: [],
            hapticActuators: Array.from({ length: Math.max(0, numHapticActuators) }, () => new GamepadHapticActuator('vibration')),
            buttonsView: [],
            axesView: [],
            axesResolvers: [],
        };
        gamepadConfig.buttons.forEach((buttonConfig) => {
            var _a;
            if (buttonConfig === null) {
                this[P_GAMEPAD].buttonsSequence.push(null);
            }
            else {
                this[P_GAMEPAD].buttonsSequence.push(buttonConfig.id);
                this[P_GAMEPAD].buttonsMap[buttonConfig.id] = new GamepadButton(buttonConfig.type, (_a = buttonConfig.eventTrigger) !== null && _a !== void 0 ? _a : null);
            }
        });
        gamepadConfig.axes.forEach((axisConfig) => {
            if (axisConfig === null) {
                this[P_GAMEPAD].axesSequence.push(null);
            }
            else {
                this[P_GAMEPAD].axesSequence.push(axisConfig.id + axisConfig.type);
                if (!this[P_GAMEPAD].axesMap[axisConfig.id]) {
                    this[P_GAMEPAD].axesMap[axisConfig.id] = { x: 0, y: 0 };
                }
            }
        });
        // Build the cached buttons array once. The GamepadButton instances are
        // stable references mutated in place, so the cached array always reflects
        // current state; null slots get a shared empty button.
        this[P_GAMEPAD].buttonsView = this[P_GAMEPAD].buttonsSequence.map((id) => id === null ? new EmptyGamepadButton() : this[P_GAMEPAD].buttonsMap[id]);
        // Precompute axis resolvers and a reusable axes array (values written in
        // place on each read).
        this[P_GAMEPAD].axesResolvers = this[P_GAMEPAD].axesSequence.map((id) => id === null
            ? null
            : {
                axisId: id.substring(0, id.length - 6),
                isY: id.substring(id.length - 6) === 'y-axis',
            });
        this[P_GAMEPAD].axesView = this[P_GAMEPAD].axesResolvers.map(() => null);
    }
    get id() {
        return this[P_GAMEPAD].id;
    }
    get index() {
        return this[P_GAMEPAD].index;
    }
    get connected() {
        return this[P_GAMEPAD].connected;
    }
    get timestamp() {
        return this[P_GAMEPAD].timestamp;
    }
    get mapping() {
        return this[P_GAMEPAD].mapping;
    }
    get axes() {
        const { axesView, axesResolvers, axesMap } = this[P_GAMEPAD];
        for (let i = 0; i < axesResolvers.length; i++) {
            const resolver = axesResolvers[i];
            if (resolver === null) {
                axesView[i] = null;
            }
            else {
                const axis = axesMap[resolver.axisId];
                // manual axes fall through to the x value, matching the prior behavior
                axesView[i] = resolver.isY ? axis.y : axis.x;
            }
        }
        return axesView;
    }
    get buttons() {
        return this[P_GAMEPAD].buttonsView;
    }
    get hapticActuators() {
        return this[P_GAMEPAD].hapticActuators;
    }
    get vibrationActuator() {
        var _a;
        return (_a = this[P_GAMEPAD].hapticActuators[0]) !== null && _a !== void 0 ? _a : null;
    }
}

/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
var XRHandedness;
(function (XRHandedness) {
    XRHandedness["None"] = "none";
    XRHandedness["Left"] = "left";
    XRHandedness["Right"] = "right";
})(XRHandedness || (XRHandedness = {}));
var XRTargetRayMode;
(function (XRTargetRayMode) {
    XRTargetRayMode["Gaze"] = "gaze";
    XRTargetRayMode["TrackedPointer"] = "tracked-pointer";
    XRTargetRayMode["Screen"] = "screen";
    XRTargetRayMode["TransientPointer"] = "transient-pointer";
})(XRTargetRayMode || (XRTargetRayMode = {}));
class XRInputSourceArray extends Array {
}
class XRInputSource {
    constructor(handedness, targetRayMode, profiles, targetRaySpace, gamepad, gripSpace, hand) {
        this[P_INPUT_SOURCE] = {
            handedness,
            targetRayMode,
            targetRaySpace,
            gripSpace,
            profiles,
            gamepad,
            hand,
        };
    }
    get handedness() {
        return this[P_INPUT_SOURCE].handedness;
    }
    get targetRayMode() {
        return this[P_INPUT_SOURCE].targetRayMode;
    }
    get targetRaySpace() {
        return this[P_INPUT_SOURCE].targetRaySpace;
    }
    get gripSpace() {
        return this[P_INPUT_SOURCE].gripSpace;
    }
    get profiles() {
        return this[P_INPUT_SOURCE].profiles;
    }
    get gamepad() {
        return this[P_INPUT_SOURCE].gamepad;
    }
    get hand() {
        return this[P_INPUT_SOURCE].hand;
    }
}

/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
class XRInputSourceEvent extends Event {
    constructor(type, eventInitDict) {
        super(type, eventInitDict);
        if (!eventInitDict.frame) {
            throw new Error('XRInputSourceEventInit.frame is required');
        }
        if (!eventInitDict.inputSource) {
            throw new Error('XRInputSourceEventInit.inputSource is required');
        }
        this.frame = eventInitDict.frame;
        this.inputSource = eventInitDict.inputSource;
    }
}

/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
const DEFAULT_TRANSFORM = {
    [XRHandedness.Left]: {
        position: new Vector3(-0.25, 1.5, -0.4),
        quaternion: new Quaternion(),
    },
    [XRHandedness.Right]: {
        position: new Vector3(0.25, 1.5, -0.4),
        quaternion: new Quaternion(),
    },
    [XRHandedness.None]: {
        position: new Vector3(0.25, 1.5, -0.4),
        quaternion: new Quaternion(),
    },
};
class XRTrackedInput {
    constructor(inputSource) {
        this[P_TRACKED_INPUT] = {
            inputSource,
            position: DEFAULT_TRANSFORM[inputSource.handedness].position.clone(),
            quaternion: DEFAULT_TRANSFORM[inputSource.handedness].quaternion.clone(),
            connected: true,
            lastFrameConnected: false,
            inputSourceChanged: true,
        };
    }
    get position() {
        return this[P_TRACKED_INPUT].position;
    }
    get quaternion() {
        return this[P_TRACKED_INPUT].quaternion;
    }
    get inputSource() {
        return this[P_TRACKED_INPUT].inputSource;
    }
    get connected() {
        return this[P_TRACKED_INPUT].connected;
    }
    set connected(value) {
        this[P_TRACKED_INPUT].connected = value;
        const gamepad = this[P_TRACKED_INPUT].inputSource.gamepad;
        if (gamepad) {
            gamepad[P_GAMEPAD].connected = value;
        }
    }
    updateTargetRaySpace() {
        const targetRaySpace = this[P_TRACKED_INPUT].inputSource.targetRaySpace;
        fromRotationTranslation(targetRaySpace[P_SPACE].offsetMatrix, this[P_TRACKED_INPUT].quaternion.quat, this[P_TRACKED_INPUT].position.vec3);
    }
    onFrameStart(frame) {
        var _a;
        this.updateTargetRaySpace();
        const session = frame.session;
        (_a = this[P_TRACKED_INPUT].inputSource.gamepad) === null || _a === void 0 ? void 0 : _a.buttons.forEach((button) => {
            var _a;
            if (button instanceof GamepadButton) {
                // apply pending values and record last frame values
                button[P_GAMEPAD].lastFrameValue =
                    (_a = button[P_GAMEPAD].immediateTransitionFrom) !== null && _a !== void 0 ? _a : button[P_GAMEPAD].value;
                button[P_GAMEPAD].immediateTransitionFrom = null;
                if (button[P_GAMEPAD].pendingValue != null) {
                    button[P_GAMEPAD].value = button[P_GAMEPAD].pendingValue;
                    button[P_GAMEPAD].pendingValue = null;
                }
                // trigger input source events
                if (button[P_GAMEPAD].eventTrigger != null) {
                    if (button[P_GAMEPAD].lastFrameValue === 0 &&
                        button[P_GAMEPAD].value > 0) {
                        session.dispatchEvent(new XRInputSourceEvent(button[P_GAMEPAD].eventTrigger, {
                            frame,
                            inputSource: this[P_TRACKED_INPUT].inputSource,
                        }));
                        session.dispatchEvent(new XRInputSourceEvent(button[P_GAMEPAD].eventTrigger + 'start', {
                            frame,
                            inputSource: this[P_TRACKED_INPUT].inputSource,
                        }));
                    }
                    else if (button[P_GAMEPAD].lastFrameValue > 0 &&
                        button[P_GAMEPAD].value === 0) {
                        session.dispatchEvent(new XRInputSourceEvent(button[P_GAMEPAD].eventTrigger + 'end', {
                            frame,
                            inputSource: this[P_TRACKED_INPUT].inputSource,
                        }));
                    }
                }
            }
        });
        this[P_TRACKED_INPUT].inputSourceChanged =
            this.connected !== this[P_TRACKED_INPUT].lastFrameConnected;
        this[P_TRACKED_INPUT].lastFrameConnected = this.connected;
    }
}

/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
class XRController extends XRTrackedInput {
    constructor(controllerConfig, handedness, globalSpace) {
        if (!controllerConfig.layout[handedness]) {
            throw new DOMException('Handedness not supported', 'InvalidStateError');
        }
        const targetRaySpace = new XRSpace(globalSpace);
        const gripSpace = controllerConfig.layout[handedness].gripOffsetMatrix
            ? new XRSpace(targetRaySpace, controllerConfig.layout[handedness].gripOffsetMatrix)
            : undefined;
        const profiles = [
            controllerConfig.profileId,
            ...controllerConfig.fallbackProfileIds,
        ];
        const inputSource = new XRInputSource(handedness, XRTargetRayMode.TrackedPointer, profiles, targetRaySpace, new Gamepad(controllerConfig.layout[handedness].gamepad, '', -1, controllerConfig.layout[handedness].numHapticActuators), gripSpace);
        super(inputSource);
        this[P_CONTROLLER] = {
            profileId: controllerConfig.profileId,
            gamepadConfig: controllerConfig.layout[handedness].gamepad,
        };
    }
    get gamepadConfig() {
        return this[P_CONTROLLER].gamepadConfig;
    }
    get profileId() {
        return this[P_CONTROLLER].profileId;
    }
    updateButtonValue(id, value) {
        if (value > 1 || value < 0) {
            console.warn(`Out-of-range value ${value} provided for button ${id}.`);
            return;
        }
        const gamepadButton = this[P_TRACKED_INPUT].inputSource.gamepad[P_GAMEPAD].buttonsMap[id];
        if (gamepadButton) {
            if (gamepadButton[P_GAMEPAD].type === 'binary' &&
                value != 1 &&
                value != 0) {
                console.warn(`Non-binary value ${value} provided for binary button ${id}.`);
                return;
            }
            gamepadButton[P_GAMEPAD].pendingValue = value;
        }
        else {
            console.warn(`Current controller does not have button ${id}.`);
        }
    }
    /**
     * Set button value immediately (bypasses pending mechanism).
     * Use this for programmatic control where value should be readable immediately.
     */
    setButtonValueImmediate(id, value) {
        if (value > 1 || value < 0) {
            console.warn(`Out-of-range value ${value} provided for button ${id}.`);
            return;
        }
        const gamepadButton = this[P_TRACKED_INPUT].inputSource.gamepad[P_GAMEPAD].buttonsMap[id];
        if (gamepadButton) {
            if (gamepadButton[P_GAMEPAD].type === 'binary' &&
                value != 1 &&
                value != 0) {
                console.warn(`Non-binary value ${value} provided for binary button ${id}.`);
                return;
            }
            // Set both value and pendingValue for immediate effect
            if (gamepadButton[P_GAMEPAD].immediateTransitionFrom === null) {
                gamepadButton[P_GAMEPAD].immediateTransitionFrom =
                    gamepadButton[P_GAMEPAD].value;
            }
            gamepadButton[P_GAMEPAD].value = value;
            gamepadButton[P_GAMEPAD].pendingValue = value;
        }
        else {
            console.warn(`Current controller does not have button ${id}.`);
        }
    }
    updateButtonTouch(id, touched) {
        const gamepadButton = this[P_TRACKED_INPUT].inputSource.gamepad[P_GAMEPAD].buttonsMap[id];
        if (gamepadButton) {
            gamepadButton[P_GAMEPAD].touched = touched;
        }
        else {
            console.warn(`Current controller does not have button ${id}.`);
        }
    }
    updateAxis(id, type, value) {
        if (value > 1 || value < -1) {
            console.warn(`Out-of-range value ${value} provided for ${id} axes.`);
            return;
        }
        const axesById = this[P_TRACKED_INPUT].inputSource.gamepad[P_GAMEPAD].axesMap[id];
        if (axesById) {
            if (type === 'x-axis') {
                axesById.x = value;
            }
            else if (type === 'y-axis') {
                axesById.y = value;
            }
        }
        else {
            console.warn(`Current controller does not have ${id} axes.`);
        }
    }
    updateAxes(id, x, y) {
        if (x > 1 || x < -1 || y > 1 || y < -1) {
            console.warn(`Out-of-range value x:${x}, y:${y} provided for ${id} axes.`);
            return;
        }
        const axesById = this[P_TRACKED_INPUT].inputSource.gamepad[P_GAMEPAD].axesMap[id];
        if (axesById) {
            axesById.x = x;
            axesById.y = y;
        }
        else {
            console.warn(`Current controller does not have ${id} axes.`);
        }
    }
    /**
     * Get the current value of a button by id
     */
    getButtonValue(id) {
        var _a;
        const gamepadButton = this[P_TRACKED_INPUT].inputSource.gamepad[P_GAMEPAD].buttonsMap[id];
        if (gamepadButton) {
            return (_a = gamepadButton[P_GAMEPAD].pendingValue) !== null && _a !== void 0 ? _a : gamepadButton.value;
        }
        return 0;
    }
    /**
     * Get the touched state of a button by id
     */
    getButtonTouched(id) {
        const gamepadButton = this[P_TRACKED_INPUT].inputSource.gamepad[P_GAMEPAD].buttonsMap[id];
        if (gamepadButton) {
            return gamepadButton.touched;
        }
        return false;
    }
    /**
     * Get the current axes values for a given id (e.g., 'thumbstick')
     */
    getAxes(id = 'thumbstick') {
        const axesById = this[P_TRACKED_INPUT].inputSource.gamepad[P_GAMEPAD].axesMap[id];
        if (axesById) {
            return { x: axesById.x, y: axesById.y };
        }
        return { x: 0, y: 0 };
    }
}

/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
class XRMesh {
    constructor(nativeMesh, meshSpace, vertices, indices, semanticLabel) {
        this[P_MESH] = {
            nativeMesh,
            frame: undefined,
            meshSpace,
            vertices,
            indices,
            lastChangedTime: performance.now(),
            semanticLabel,
        };
    }
    get meshSpace() {
        return this[P_MESH].meshSpace;
    }
    get vertices() {
        return this[P_MESH].vertices;
    }
    get indices() {
        return this[P_MESH].indices;
    }
    get lastChangedTime() {
        return this[P_MESH].lastChangedTime;
    }
    get semanticLabel() {
        return this[P_MESH].semanticLabel;
    }
}
class XRMeshSet extends Set {
}
class NativeMesh {
    constructor(transform, vertices, indices, semanticLabel) {
        this.transform = transform;
        this.vertices = vertices;
        this.indices = indices;
        this.semanticLabel = semanticLabel;
    }
}

/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
// Source: https://github.com/immersive-web/semantic-labels/blob/master/labels.json
/**
 * Enum for semantic labels.
 * For more details, see the {@link https://github.com/immersive-web/semantic-labels | Semantic Labels Documentation}.
 */
var XRSemanticLabels;
(function (XRSemanticLabels) {
    XRSemanticLabels["Desk"] = "desk";
    XRSemanticLabels["Couch"] = "couch";
    XRSemanticLabels["Floor"] = "floor";
    XRSemanticLabels["Ceiling"] = "ceiling";
    XRSemanticLabels["Wall"] = "wall";
    XRSemanticLabels["Door"] = "door";
    XRSemanticLabels["Window"] = "window";
    XRSemanticLabels["Table"] = "table";
    XRSemanticLabels["Shelf"] = "shelf";
    XRSemanticLabels["Bed"] = "bed";
    XRSemanticLabels["Screen"] = "screen";
    XRSemanticLabels["Lamp"] = "lamp";
    XRSemanticLabels["Plant"] = "plant";
    XRSemanticLabels["WallArt"] = "wall art";
    XRSemanticLabels["GlobalMesh"] = "global mesh";
    XRSemanticLabels["Other"] = "other";
})(XRSemanticLabels || (XRSemanticLabels = {}));

/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
var XRPlaneOrientation;
(function (XRPlaneOrientation) {
    XRPlaneOrientation["Horizontal"] = "horizontal";
    XRPlaneOrientation["Vertical"] = "vertical";
})(XRPlaneOrientation || (XRPlaneOrientation = {}));
/**
 * XRPlane orientation mapping from semantic labels.
 * For more details, see the {@link https://github.com/immersive-web/semantic-labels | Semantic Labels Documentation}.
 */
const XREntityOrientation = {
    [XRSemanticLabels.Desk]: XRPlaneOrientation.Horizontal,
    [XRSemanticLabels.Couch]: XRPlaneOrientation.Horizontal,
    [XRSemanticLabels.Floor]: XRPlaneOrientation.Horizontal,
    [XRSemanticLabels.Ceiling]: XRPlaneOrientation.Horizontal,
    [XRSemanticLabels.Wall]: XRPlaneOrientation.Vertical,
    [XRSemanticLabels.Door]: XRPlaneOrientation.Vertical,
    [XRSemanticLabels.Window]: XRPlaneOrientation.Vertical,
    [XRSemanticLabels.Table]: XRPlaneOrientation.Horizontal,
    [XRSemanticLabels.Shelf]: XRPlaneOrientation.Horizontal,
    [XRSemanticLabels.Bed]: XRPlaneOrientation.Horizontal,
    [XRSemanticLabels.Screen]: XRPlaneOrientation.Horizontal,
    [XRSemanticLabels.Lamp]: XRPlaneOrientation.Horizontal,
    [XRSemanticLabels.Plant]: XRPlaneOrientation.Horizontal,
    [XRSemanticLabels.WallArt]: XRPlaneOrientation.Vertical,
};
class XRPlane {
    constructor(nativePlane, planeSpace, polygon, semanticLabel) {
        this[P_PLANE] = {
            nativePlane,
            frame: undefined,
            planeSpace,
            polygon,
            lastChangedTime: performance.now(),
            semanticLabel,
            orientation: semanticLabel
                ? XREntityOrientation[semanticLabel]
                : undefined,
        };
    }
    get planeSpace() {
        return this[P_PLANE].planeSpace;
    }
    get polygon() {
        return this[P_PLANE].polygon;
    }
    get orientation() {
        return this[P_PLANE].orientation;
    }
    get lastChangedTime() {
        return this[P_PLANE].lastChangedTime;
    }
    get semanticLabel() {
        return this[P_PLANE].semanticLabel;
    }
}
class XRPlaneSet extends Set {
}
class NativePlane {
    constructor(transform, polygon, semanticLabel) {
        this.transform = transform;
        this.polygon = polygon;
        this.semanticLabel = semanticLabel;
    }
}

/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
class XRCPUDepthInformation {
    constructor(data, width, height, normDepthBufferFromNormView, rawValueToMeters, dataFormat) {
        this[P_DEPTH_INFO] = {
            data,
            width,
            height,
            normDepthBufferFromNormView,
            rawValueToMeters,
            dataFormat,
            view: dataFormat === 'float32'
                ? new Float32Array(data)
                : new Uint8Array(data),
        };
    }
    get data() {
        return this[P_DEPTH_INFO].data;
    }
    get width() {
        return this[P_DEPTH_INFO].width;
    }
    get height() {
        return this[P_DEPTH_INFO].height;
    }
    get normDepthBufferFromNormView() {
        return this[P_DEPTH_INFO].normDepthBufferFromNormView;
    }
    get rawValueToMeters() {
        return this[P_DEPTH_INFO].rawValueToMeters;
    }
    get dataFormat() {
        return this[P_DEPTH_INFO].dataFormat;
    }
    getDepthInMeters(x, y) {
        const { width, height, rawValueToMeters, dataFormat, view } = this[P_DEPTH_INFO];
        if (x < 0 || x >= 1 || y < 0 || y >= 1) {
            throw new RangeError('Normalized coordinates must be in [0, 1) range.');
        }
        const col = Math.floor(x * width);
        const row = Math.floor(y * height);
        if (dataFormat === 'float32') {
            const floatView = view;
            const index = row * width + col;
            return floatView[index] * rawValueToMeters;
        }
        else {
            // luminance-alpha: 16-bit unsigned int packed as two bytes
            const byteView = view;
            const index = (row * width + col) * 2;
            const rawValue = byteView[index] + byteView[index + 1] * 256;
            return rawValue * rawValueToMeters;
        }
    }
}

/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
class XRWebGLDepthInformation {
    constructor(texture, width, height, normDepthBufferFromNormView, rawValueToMeters, depthNear, depthFar, textureType, imageIndex) {
        this.texture = texture;
        this.width = width;
        this.height = height;
        this.normDepthBufferFromNormView = normDepthBufferFromNormView;
        this.rawValueToMeters = rawValueToMeters;
        this.depthNear = depthNear;
        this.depthFar = depthFar;
        this.textureType = textureType;
        this.imageIndex = imageIndex;
        this.isValid = true;
    }
}
class XRWebGLBinding {
    constructor(session, _context) {
        this._session = session;
    }
    getDepthInformation(view) {
        var _a;
        const frame = this._session[P_SESSION].activeFrame;
        if (!frame || !frame[P_FRAME].active) {
            throw new DOMException('XRFrame access outside the callback that produced it is invalid.', 'InvalidStateError');
        }
        if (!this._session[P_SESSION].enabledFeatures.includes('depth-sensing')) {
            throw new DOMException('depth-sensing feature is not enabled on this session.', 'InvalidStateError');
        }
        if (this._session[P_SESSION].depthSensingUsage !== 'gpu-optimized') {
            throw new DOMException('getDepthInformation on XRWebGLBinding requires gpu-optimized depth sensing usage.', 'InvalidStateError');
        }
        const eye = view[P_VIEW].eye;
        return (_a = frame[P_FRAME].gpuDepthDataMap.get(eye)) !== null && _a !== void 0 ? _a : null;
    }
}

/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
class XRAnchor {
    constructor(anchorSpace, session) {
        this[P_ANCHOR] = {
            anchorSpace,
            session,
            deleted: false,
        };
        session[P_SESSION].trackedAnchors.add(this);
    }
    get anchorSpace() {
        if (this[P_ANCHOR].deleted) {
            throw new DOMException('XRAnchor has already been deleted.', 'InvalidStateError');
        }
        return this[P_ANCHOR].anchorSpace;
    }
    requestPersistentHandle() {
        return new Promise((resolve, reject) => {
            if (this[P_ANCHOR].deleted) {
                reject(new DOMException('XRAnchor has already been deleted.', 'InvalidStateError'));
            }
            else {
                const persistentAnchors = this[P_ANCHOR].session[P_SESSION].persistentAnchors;
                for (const [uuid, anchor] of persistentAnchors.entries()) {
                    if (anchor === this) {
                        resolve(uuid);
                        return;
                    }
                }
                const uuid = crypto.randomUUID();
                XRAnchorUtils.createPersistentAnchor(this[P_ANCHOR].session, this, uuid);
                resolve(uuid);
            }
        });
    }
    delete() {
        if (this[P_ANCHOR].deleted) {
            return;
        }
        this[P_ANCHOR].anchorSpace = null;
        this[P_ANCHOR].deleted = true;
        this[P_ANCHOR].session[P_SESSION].trackedAnchors.delete(this);
    }
}
class XRAnchorSet extends Set {
}
const PersistentAnchorsStorageKey = '@immersive-web-emulation-runtime/persistent-anchors';
class XRAnchorUtils {
    static recoverPersistentAnchorsFromStorage(session) {
        const persistentAnchors = JSON.parse(localStorage.getItem(PersistentAnchorsStorageKey) || '{}');
        const globalSpace = session[P_SESSION].device[P_DEVICE].globalSpace;
        Object.entries(persistentAnchors).forEach(([uuid, offsetMatrix]) => {
            const anchorSpace = new XRSpace(globalSpace, offsetMatrix);
            const anchor = new XRAnchor(anchorSpace, session);
            session[P_SESSION].persistentAnchors.set(uuid, anchor);
        });
    }
    static createPersistentAnchor(session, anchor, uuid) {
        session[P_SESSION].trackedAnchors.add(anchor);
        session[P_SESSION].persistentAnchors.set(uuid, anchor);
        const persistentAnchors = JSON.parse(localStorage.getItem(PersistentAnchorsStorageKey) || '{}');
        persistentAnchors[uuid] = Array.from(anchor[P_ANCHOR].anchorSpace[P_SPACE].offsetMatrix);
        localStorage.setItem(PersistentAnchorsStorageKey, JSON.stringify(persistentAnchors));
    }
}

/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
class XRRigidTransform {
    constructor(position, orientation) {
        // Default values
        const defaultPosition = fromValues$2(0, 0, 0);
        const defaultOrientation = create$2();
        const resolvedPosition = position
            ? fromValues$2(position.x, position.y, position.z)
            : defaultPosition;
        const resolvedOrientation = orientation
            ? normalize(create$2(), fromValues(orientation.x, orientation.y, orientation.z, orientation.w))
            : defaultOrientation;
        this[P_RIGID_TRANSFORM] = {
            matrix: create$5(),
            position: resolvedPosition,
            orientation: resolvedOrientation,
            positionPoint: new DOMPointReadOnly(resolvedPosition[0], resolvedPosition[1], resolvedPosition[2], 1),
            orientationPoint: new DOMPointReadOnly(resolvedOrientation[0], resolvedOrientation[1], resolvedOrientation[2], resolvedOrientation[3]),
            inverse: null,
        };
        this.updateMatrix();
    }
    updateMatrix() {
        fromRotationTranslation(this[P_RIGID_TRANSFORM].matrix, this[P_RIGID_TRANSFORM].orientation, this[P_RIGID_TRANSFORM].position);
    }
    get matrix() {
        return this[P_RIGID_TRANSFORM].matrix;
    }
    get position() {
        return this[P_RIGID_TRANSFORM].positionPoint;
    }
    get orientation() {
        return this[P_RIGID_TRANSFORM].orientationPoint;
    }
    get inverse() {
        if (!this[P_RIGID_TRANSFORM].inverse) {
            const invMatrix = create$5();
            if (!invert$1(invMatrix, this[P_RIGID_TRANSFORM].matrix)) {
                throw new Error('Matrix is not invertible.');
            }
            // Decomposing the inverse matrix into position and orientation
            let invPosition = create$4();
            getTranslation(invPosition, invMatrix);
            let invOrientation = create$2();
            getRotation(invOrientation, invMatrix);
            // Creating a new XRRigidTransform for the inverse
            this[P_RIGID_TRANSFORM].inverse = new XRRigidTransform(new DOMPointReadOnly(invPosition[0], invPosition[1], invPosition[2], 1), new DOMPointReadOnly(invOrientation[0], invOrientation[1], invOrientation[2], invOrientation[3]));
            // Setting the inverse of the inverse to be this transform
            this[P_RIGID_TRANSFORM].inverse[P_RIGID_TRANSFORM].inverse = this;
        }
        return this[P_RIGID_TRANSFORM].inverse;
    }
}

let DOMPointReadOnly$1 = class DOMPointReadOnly {
    constructor(x = 0, y = 0, z = 0, w = 1) {
        this.x = x;
        this.y = y;
        this.z = z;
        this.w = w;
    }
};
class XRRay {
    constructor(origin, direction) {
        const _origin = { x: 0, y: 0, z: 0, w: 1 };
        const _direction = { x: 0, y: 0, z: -1, w: 0 };
        if (origin instanceof XRRigidTransform) {
            const transform = origin;
            const matrix = transform.matrix;
            const originVec4 = set$1(create$3(), _origin.x, _origin.y, _origin.z, _origin.w);
            const directionVec4 = set$1(create$3(), _direction.x, _direction.y, _direction.z, _direction.w);
            transformMat4(originVec4, originVec4, matrix);
            transformMat4(directionVec4, directionVec4, matrix);
            _origin.x = originVec4[0];
            _origin.y = originVec4[1];
            _origin.z = originVec4[2];
            _origin.w = originVec4[3];
            _direction.x = directionVec4[0];
            _direction.y = directionVec4[1];
            _direction.z = directionVec4[2];
            _direction.w = directionVec4[3];
        }
        else {
            if (origin) {
                _origin.x = origin.x;
                _origin.y = origin.y;
                _origin.z = origin.z;
                _origin.w = origin.w;
            }
            if (direction) {
                if ((direction.x === 0 && direction.y === 0 && direction.z === 0) ||
                    direction.w !== 0) {
                    throw new DOMException('Invalid direction value to construct XRRay', 'TypeError');
                }
                _direction.x = direction.x;
                _direction.y = direction.y;
                _direction.z = direction.z;
                _direction.w = direction.w;
            }
        }
        const length = Math.sqrt(_direction.x * _direction.x +
            _direction.y * _direction.y +
            _direction.z * _direction.z) || 1;
        _direction.x = _direction.x / length;
        _direction.y = _direction.y / length;
        _direction.z = _direction.z / length;
        this[P_RAY] = {
            origin: new DOMPointReadOnly$1(_origin.x, _origin.y, _origin.z, _origin.w),
            direction: new DOMPointReadOnly$1(_direction.x, _direction.y, _direction.z, _direction.w),
            matrix: null,
        };
    }
    get origin() {
        return this[P_RAY].origin;
    }
    get direction() {
        return this[P_RAY].direction;
    }
    get matrix() {
        if (this[P_RAY].matrix) {
            return this[P_RAY].matrix;
        }
        const z = set$2(create$4(), 0, 0, -1);
        const origin = set$2(create$4(), this[P_RAY].origin.x, this[P_RAY].origin.y, this[P_RAY].origin.z);
        const direction = set$2(create$4(), this[P_RAY].direction.x, this[P_RAY].direction.y, this[P_RAY].direction.z);
        const axis = cross(create$4(), direction, z);
        const cosAngle = dot$2(direction, z);
        const rotation = create$5();
        if (cosAngle > -1 && cosAngle < 1) {
            fromRotation(rotation, Math.acos(cosAngle), axis);
        }
        else if (cosAngle === -1) {
            fromRotation(rotation, Math.acos(cosAngle), set$2(create$4(), 1, 0, 0));
        }
        else {
            identity(rotation);
        }
        const translation = fromTranslation(create$5(), origin);
        const matrix = multiply$2(create$5(), translation, rotation);
        this[P_RAY].matrix = new Float32Array(matrix);
        return this[P_RAY].matrix;
    }
}

/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
class XRHitTestSource {
    constructor(session, options) {
        var _a;
        this[P_HIT_TEST] = {
            session,
            space: options.space,
            offsetRay: (_a = options.offsetRay) !== null && _a !== void 0 ? _a : new XRRay(),
            entityTypes: options.entityTypes,
        };
    }
    cancel() {
        this[P_HIT_TEST].session[P_SESSION].hitTestSources.delete(this);
    }
}
class XRHitTestResult {
    constructor(frame, offsetSpace) {
        this[P_HIT_TEST] = { frame, offsetSpace };
    }
    getPose(baseSpace) {
        return this[P_HIT_TEST].frame.getPose(this[P_HIT_TEST].offsetSpace, baseSpace);
    }
    createAnchor() {
        return this[P_HIT_TEST].frame.createAnchor(new XRRigidTransform(), this[P_HIT_TEST].offsetSpace);
    }
}

/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
class XRInputSourcesChangeEvent extends Event {
    constructor(type, eventInitDict) {
        super(type, eventInitDict);
        if (!eventInitDict.session) {
            throw new Error('XRInputSourcesChangeEventInit.session is required');
        }
        if (!eventInitDict.added) {
            throw new Error('XRInputSourcesChangeEventInit.added is required');
        }
        if (!eventInitDict.removed) {
            throw new Error('XRInputSourcesChangeEventInit.removed is required');
        }
        this.session = eventInitDict.session;
        this.added = eventInitDict.added;
        this.removed = eventInitDict.removed;
    }
}

/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
var _a;
var XRReferenceSpaceType;
(function (XRReferenceSpaceType) {
    XRReferenceSpaceType["Viewer"] = "viewer";
    XRReferenceSpaceType["Local"] = "local";
    XRReferenceSpaceType["LocalFloor"] = "local-floor";
    XRReferenceSpaceType["BoundedFloor"] = "bounded-floor";
    XRReferenceSpaceType["Unbounded"] = "unbounded";
})(XRReferenceSpaceType || (XRReferenceSpaceType = {}));
class XRReferenceSpace extends XRSpace {
    constructor(type, parentSpace, offsetMatrix) {
        super(parentSpace, offsetMatrix);
        this[_a] = {
            type: null,
            onreset: null,
        };
        this[P_REF_SPACE].type = type;
    }
    get onreset() {
        return this[P_REF_SPACE].onreset;
    }
    set onreset(callback) {
        if (this[P_REF_SPACE].onreset) {
            this.removeEventListener('reset', this[P_REF_SPACE].onreset);
        }
        this[P_REF_SPACE].onreset = callback;
        if (callback) {
            this.addEventListener('reset', callback);
        }
    }
    // Create a new XRReferenceSpace with an offset from the current space
    getOffsetReferenceSpace(originOffset) {
        // Create a new XRReferenceSpace with the originOffset as its offsetMatrix
        // The new space's parent is set to 'this' (the current XRReferenceSpace)
        return new XRReferenceSpace(this[P_REF_SPACE].type, this, originOffset);
    }
}
_a = P_REF_SPACE;

/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
class XRRenderState {
    constructor(init = {}, oldState) {
        var _a, _b, _c, _d, _e, _f, _g, _h;
        this[P_RENDER_STATE] = {
            // Use nullish coalescing so a legitimate 0 (e.g.
            // inlineVerticalFieldOfView=0) is not replaced by the default.
            depthNear: (_b = (_a = init.depthNear) !== null && _a !== void 0 ? _a : oldState === null || oldState === void 0 ? void 0 : oldState.depthNear) !== null && _b !== void 0 ? _b : 0.1,
            depthFar: (_d = (_c = init.depthFar) !== null && _c !== void 0 ? _c : oldState === null || oldState === void 0 ? void 0 : oldState.depthFar) !== null && _d !== void 0 ? _d : 1000.0,
            inlineVerticalFieldOfView: (_f = (_e = init.inlineVerticalFieldOfView) !== null && _e !== void 0 ? _e : oldState === null || oldState === void 0 ? void 0 : oldState.inlineVerticalFieldOfView) !== null && _f !== void 0 ? _f : null,
            baseLayer: (_h = (_g = init.baseLayer) !== null && _g !== void 0 ? _g : oldState === null || oldState === void 0 ? void 0 : oldState.baseLayer) !== null && _h !== void 0 ? _h : null,
        };
    }
    get depthNear() {
        return this[P_RENDER_STATE].depthNear;
    }
    get depthFar() {
        return this[P_RENDER_STATE].depthFar;
    }
    get inlineVerticalFieldOfView() {
        return this[P_RENDER_STATE].inlineVerticalFieldOfView;
    }
    get baseLayer() {
        return this[P_RENDER_STATE].baseLayer;
    }
}

/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
class XRSessionEvent extends Event {
    constructor(type, eventInitDict) {
        super(type, eventInitDict);
        if (!eventInitDict.session) {
            throw new Error('XRSessionEventInit.session is required');
        }
        this.session = eventInitDict.session;
    }
}

/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
var XREye;
(function (XREye) {
    XREye["None"] = "none";
    XREye["Left"] = "left";
    XREye["Right"] = "right";
})(XREye || (XREye = {}));
class XRView {
    constructor(eye, projectionMatrix, transform, session) {
        this[P_VIEW] = {
            eye,
            projectionMatrix,
            transform,
            recommendedViewportScale: null,
            requestedViewportScale: 1.0,
            session,
        };
    }
    get eye() {
        return this[P_VIEW].eye;
    }
    get projectionMatrix() {
        return this[P_VIEW].projectionMatrix;
    }
    get transform() {
        return this[P_VIEW].transform;
    }
    get recommendedViewportScale() {
        return this[P_VIEW].recommendedViewportScale;
    }
    requestViewportScale(scale) {
        if (scale === null || scale <= 0 || scale > 1) {
            console.warn('Invalid scale value. Scale must be > 0 and <= 1.');
            return;
        }
        this[P_VIEW].requestedViewportScale = scale;
    }
}

/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
class XRPose {
    constructor(transform, emulatedPosition = false, linearVelocity = undefined, angularVelocity = undefined) {
        this[P_POSE] = {
            transform,
            emulatedPosition,
            linearVelocity,
            angularVelocity,
        };
    }
    get transform() {
        return this[P_POSE].transform;
    }
    get emulatedPosition() {
        return this[P_POSE].emulatedPosition;
    }
    get linearVelocity() {
        return this[P_POSE].linearVelocity;
    }
    get angularVelocity() {
        return this[P_POSE].angularVelocity;
    }
}

/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
class XRJointPose extends XRPose {
    constructor(transform, radius, emulatedPosition = false, linearVelocity = undefined, angularVelocity = undefined) {
        super(transform, emulatedPosition, linearVelocity, angularVelocity);
        this[P_JOINT_POSE] = { radius };
    }
    get radius() {
        return this[P_JOINT_POSE].radius;
    }
}

/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
class XRViewerPose extends XRPose {
    constructor(transform, views, emulatedPosition = false, linearVelocity = undefined, angularVelocity = undefined) {
        super(transform, emulatedPosition, linearVelocity, angularVelocity);
        this[P_VIEWER_POSE] = {
            views: Object.freeze(views),
        };
    }
    get views() {
        return this[P_VIEWER_POSE].views;
    }
}

/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
const spaceGlobalMatrix = create$5();
const baseSpaceGlobalMatrix = create$5();
const baseSpaceGlobalMatrixInverse = create$5();
// Scratch reused by getPose; values are copied into the returned pose's
// DOMPointInit literals before the next call, so reuse is safe.
const scratchPosition$1 = create$4();
const scratchOrientation$1 = create$2();
// Hoisted eye lists so getViewerPose doesn't allocate a fresh array per frame.
const INLINE_EYES = [XREye.None];
const STEREO_EYES = [XREye.Left, XREye.Right];
const getOffsetMatrix = (offsetMatrix, space, baseSpace) => {
    XRSpaceUtils.calculateGlobalOffsetMatrix(space, spaceGlobalMatrix);
    XRSpaceUtils.calculateGlobalOffsetMatrix(baseSpace, baseSpaceGlobalMatrix);
    invert$1(baseSpaceGlobalMatrixInverse, baseSpaceGlobalMatrix);
    multiply$2(offsetMatrix, baseSpaceGlobalMatrixInverse, spaceGlobalMatrix);
};
class XRFrame {
    constructor(session, id, active, animationFrame, predictedDisplayTime) {
        this[P_FRAME] = {
            session,
            id,
            active,
            animationFrame,
            predictedDisplayTime,
            tempMat4: create$5(),
            detectedPlanes: new XRPlaneSet(),
            detectedMeshes: new XRMeshSet(),
            trackedAnchors: session[P_SESSION].frameTrackedAnchors,
            hitTestResultsMap: new Map(),
            depthDataMap: new Map(),
            gpuDepthDataMap: new Map(),
        };
    }
    get session() {
        return this[P_FRAME].session;
    }
    get predictedDisplayTime() {
        return this[P_FRAME].predictedDisplayTime;
    }
    getPose(space, baseSpace) {
        if (!this[P_FRAME].active) {
            throw new DOMException('XRFrame access outside the callback that produced it is invalid.', 'InvalidStateError');
        }
        getOffsetMatrix(this[P_FRAME].tempMat4, space, baseSpace);
        getTranslation(scratchPosition$1, this[P_FRAME].tempMat4);
        getRotation(scratchOrientation$1, this[P_FRAME].tempMat4);
        return new XRPose(new XRRigidTransform({
            x: scratchPosition$1[0],
            y: scratchPosition$1[1],
            z: scratchPosition$1[2],
            w: 1.0,
        }, {
            x: scratchOrientation$1[0],
            y: scratchOrientation$1[1],
            z: scratchOrientation$1[2],
            w: scratchOrientation$1[3],
        }), space[P_SPACE].emulated);
    }
    getViewerPose(referenceSpace) {
        if (!this[P_FRAME].animationFrame) {
            throw new DOMException('getViewerPose can only be called on XRFrame objects passed to XRSession.requestAnimationFrame callbacks.', 'InvalidStateError');
        }
        const session = this[P_FRAME].session;
        const device = session[P_SESSION].device;
        const pose = this.getPose(device.viewerSpace, referenceSpace);
        const eyes = session[P_SESSION].mode === 'inline' ? INLINE_EYES : STEREO_EYES;
        const views = [];
        eyes.forEach((eye) => {
            const viewSpace = device.viewSpaces[eye];
            const viewPose = this.getPose(viewSpace, referenceSpace);
            const projectionMatrix = session[P_SESSION].getProjectionMatrix(eye);
            const view = new XRView(eye, new Float32Array(projectionMatrix), viewPose.transform, session);
            views.push(view);
        });
        return new XRViewerPose(pose.transform, views, false);
    }
    getJointPose(joint, baseSpace) {
        const xrPose = this.getPose(joint, baseSpace);
        const radius = joint[P_JOINT_SPACE].radius;
        return new XRJointPose(xrPose.transform, radius, false);
    }
    fillJointRadii(jointSpaces, radii) {
        // converting from sequence type to array
        jointSpaces = Array.from(jointSpaces);
        if (!this[P_FRAME].active) {
            throw new DOMException('XRFrame access outside the callback that produced it is invalid.', 'InvalidStateError');
        }
        if (jointSpaces.length > radii.length) {
            throw new DOMException('The length of jointSpaces is larger than the number of elements in radii', 'TypeError');
        }
        let allValid = true;
        for (let offset = 0; offset < jointSpaces.length; offset++) {
            if (!jointSpaces[offset][P_JOINT_SPACE].radius) {
                radii[offset] = NaN;
                allValid = false;
            }
            else {
                radii[offset] = jointSpaces[offset][P_JOINT_SPACE].radius;
            }
        }
        return allValid;
    }
    fillPoses(spaces, baseSpace, transforms) {
        // converting from sequence type to array
        spaces = Array.from(spaces);
        if (!this[P_FRAME].active) {
            throw new DOMException('XRFrame access outside the callback that produced it is invalid.', 'InvalidStateError');
        }
        if (spaces.length * 16 > transforms.length) {
            throw new DOMException('The length of spaces multiplied by 16 is larger than the number of elements in transforms', 'TypeError');
        }
        spaces.forEach((space, i) => {
            getOffsetMatrix(this[P_FRAME].tempMat4, space, baseSpace);
            transforms.set(this[P_FRAME].tempMat4, i * 16);
        });
        return true;
    }
    get detectedPlanes() {
        if (!this[P_FRAME].active) {
            throw new DOMException('XRFrame access outside the callback that produced it is invalid.', 'InvalidStateError');
        }
        return this[P_FRAME].detectedPlanes;
    }
    get detectedMeshes() {
        if (!this[P_FRAME].active) {
            throw new DOMException('XRFrame access outside the callback that produced it is invalid.', 'InvalidStateError');
        }
        return this[P_FRAME].detectedMeshes;
    }
    get trackedAnchors() {
        if (!this[P_FRAME].active) {
            throw new DOMException('XRFrame access outside the callback that produced it is invalid.', 'InvalidStateError');
        }
        return this[P_FRAME].trackedAnchors;
    }
    createAnchor(pose, space) {
        return new Promise((resolve, reject) => {
            if (!this[P_FRAME].active) {
                reject(new DOMException('XRFrame access outside the callback that produced it is invalid.', 'InvalidStateError'));
            }
            else {
                const globalSpace = this[P_FRAME].session[P_SESSION].device[P_DEVICE].globalSpace;
                const tempSpace = new XRSpace(space, pose.matrix);
                const globalOffsetMatrix = XRSpaceUtils.calculateGlobalOffsetMatrix(tempSpace);
                const anchorSpace = new XRSpace(globalSpace, globalOffsetMatrix);
                const anchor = new XRAnchor(anchorSpace, this[P_FRAME].session);
                this[P_FRAME].session[P_SESSION].trackedAnchors.add(anchor);
                this[P_FRAME].session[P_SESSION].newAnchors.set(anchor, {
                    resolve,
                    reject,
                });
            }
        });
    }
    getHitTestResults(hitTestSource) {
        if (!this[P_FRAME].active) {
            throw new DOMException('XRFrame access outside the callback that produced it is invalid.', 'InvalidStateError');
        }
        else if (!this[P_FRAME].hitTestResultsMap.has(hitTestSource)) {
            throw new DOMException('Requested hit test results are not available for current frame.', 'InvalidStateError');
        }
        else {
            return [...this[P_FRAME].hitTestResultsMap.get(hitTestSource)];
        }
    }
    getDepthInformation(view) {
        var _a;
        if (!this[P_FRAME].active) {
            throw new DOMException('XRFrame access outside the callback that produced it is invalid.', 'InvalidStateError');
        }
        if (!this[P_FRAME].session[P_SESSION].enabledFeatures.includes('depth-sensing')) {
            throw new DOMException('depth-sensing feature is not enabled on this session.', 'InvalidStateError');
        }
        return (_a = this[P_FRAME].depthDataMap.get(view[P_VIEW].eye)) !== null && _a !== void 0 ? _a : null;
    }
}

/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
var XREnvironmentBlendMode;
(function (XREnvironmentBlendMode) {
    XREnvironmentBlendMode["Opaque"] = "opaque";
    XREnvironmentBlendMode["AlphaBlend"] = "alpha-blend";
    XREnvironmentBlendMode["Additive"] = "additive";
})(XREnvironmentBlendMode || (XREnvironmentBlendMode = {}));
var XRInteractionMode;
(function (XRInteractionMode) {
    XRInteractionMode["ScreenSpace"] = "screen-space";
    XRInteractionMode["WorldSpace"] = "world-space";
})(XRInteractionMode || (XRInteractionMode = {}));
class XRSession extends EventTarget {
    constructor(device, mode, enabledFeatures, _depthSensing) {
        var _a, _b;
        super();
        this[P_SESSION] = {
            device,
            mode,
            renderState: new XRRenderState(),
            pendingRenderState: null,
            enabledFeatures: enabledFeatures,
            hasAnchors: enabledFeatures.includes('anchors'),
            hasPlanes: enabledFeatures.includes('plane-detection'),
            hasMeshes: enabledFeatures.includes('mesh-detection'),
            hasDepth: enabledFeatures.includes('depth-sensing'),
            hasHitTest: enabledFeatures.includes('hit-test'),
            hasGazeTracking: enabledFeatures.includes('gaze-tracking') ||
                enabledFeatures.includes('eye-tracking'),
            supportedFrameRates: new Float32Array(device.supportedFrameRates),
            isSystemKeyboardSupported: false,
            ended: false,
            projectionMatrices: {
                [XREye.Left]: create$5(),
                [XREye.Right]: create$5(),
                [XREye.None]: create$5(),
            },
            getProjectionMatrix: (eye) => {
                return this[P_SESSION].projectionMatrices[eye];
            },
            referenceSpaceIsSupported: (referenceSpaceType) => {
                if (!this[P_SESSION].enabledFeatures.includes(referenceSpaceType)) {
                    return false;
                }
                switch (referenceSpaceType) {
                    case XRReferenceSpaceType.Viewer:
                        return true;
                    case XRReferenceSpaceType.Local:
                    case XRReferenceSpaceType.LocalFloor:
                    case XRReferenceSpaceType.BoundedFloor:
                    case XRReferenceSpaceType.Unbounded:
                        return this[P_SESSION].mode != 'inline';
                }
            },
            frameHandle: 0,
            frameCallbacks: [],
            currentFrameCallbacks: null,
            onDeviceFrame: () => {
                if (this[P_SESSION].ended) {
                    return;
                }
                this[P_SESSION].deviceFrameHandle = globalThis.requestAnimationFrame(this[P_SESSION].onDeviceFrame);
                if (this[P_SESSION].pendingRenderState != null) {
                    this[P_SESSION].renderState = this[P_SESSION].pendingRenderState;
                    this[P_SESSION].pendingRenderState = null;
                    this[P_SESSION].device[P_DEVICE].onBaseLayerSet(this[P_SESSION].renderState.baseLayer);
                }
                const baseLayer = this[P_SESSION].renderState.baseLayer;
                if (baseLayer === null) {
                    return;
                }
                const context = baseLayer.context;
                const canvas = context.canvas;
                /**
                 * This code snippet is designed to clear the buffers attached to an opaque framebuffer
                 * at the beginning of each XR animation frame, but it only applies to immersive XR sessions.
                 * The process is as follows:
                 *
                 * 1. Check if the session is immersive: It verifies if `session.immersive` is true.
                 *    This ensures that the buffer clearing operations are only performed for immersive
                 *    sessions, which have exclusive access to the XR device's display.
                 *
                 * 2. Save current clear values: The current clear values for the color, depth, and
                 *    stencil buffers are stored. These values need to be restored after clearing the
                 *    buffers to maintain the application's rendering state as expected.
                 *
                 * 3. Set clear values to defaults: The clear color is set to transparent black, the
                 *    clear depth to the maximum depth value (1.0), and the clear stencil to 0. This
                 *    ensures that the buffers are reset to a known state, free from any residual data.
                 *
                 * 4. Clear the buffers: The depth, color, and stencil buffers are cleared, removing
                 *    any content from previous frames and preparing them for new rendering operations.
                 *
                 * 5. Restore previous clear values: The original clear values are reinstated to return
                 *    the WebGL context to its state prior to this operation, allowing subsequent rendering
                 *    to proceed without interference.
                 *
                 * This clearing process is crucial for some XR devices to function correctly and to
                 * prevent rendering artifacts from past frames. It ensures that each new frame starts
                 * with a clean slate.
                 */
                if (this[P_SESSION].mode != 'inline') {
                    const currentClearColor = context.getParameter(context.COLOR_CLEAR_VALUE);
                    const currentClearDepth = context.getParameter(context.DEPTH_CLEAR_VALUE);
                    const currentClearStencil = context.getParameter(context.STENCIL_CLEAR_VALUE);
                    context.clearColor(0.0, 0.0, 0.0, 0.0);
                    context.clearDepth(1);
                    context.clearStencil(0.0);
                    context.clear(context.DEPTH_BUFFER_BIT |
                        context.COLOR_BUFFER_BIT |
                        context.STENCIL_BUFFER_BIT);
                    context.clearColor(currentClearColor[0], currentClearColor[1], currentClearColor[2], currentClearColor[3]);
                    context.clearDepth(currentClearDepth);
                    context.clearStencil(currentClearStencil);
                }
                // Calculate projection matrices
                const { depthNear, depthFar } = this[P_SESSION].renderState;
                const { width, height } = canvas;
                if (this[P_SESSION].mode !== 'inline') {
                    const aspect = (width * (this[P_SESSION].device.stereoEnabled ? 0.5 : 1.0)) /
                        height;
                    perspective(this[P_SESSION].projectionMatrices[XREye.Left], this[P_SESSION].device.fovy, aspect, depthNear, depthFar);
                    copy$3(this[P_SESSION].projectionMatrices[XREye.Right], this[P_SESSION].projectionMatrices[XREye.Left]);
                }
                else {
                    const aspect = width / height;
                    perspective(this[P_SESSION].projectionMatrices[XREye.None], this[P_SESSION].renderState.inlineVerticalFieldOfView, aspect, depthNear, depthFar);
                }
                const now = performance.now();
                const frame = new XRFrame(this, this[P_SESSION].frameHandle, true, true, now);
                const devui = this[P_SESSION].device[P_DEVICE].devui;
                if (devui) {
                    devui.render(now);
                }
                if (this[P_SESSION].mode === 'immersive-ar') {
                    const sem = this[P_SESSION].device[P_DEVICE].sem;
                    if (sem) {
                        sem.render(now);
                    }
                }
                if (this[P_SESSION].hasAnchors) {
                    this[P_SESSION].updateTrackedAnchors();
                }
                if (this[P_SESSION].hasPlanes) {
                    this[P_SESSION].updateTrackedPlanes(frame);
                }
                if (this[P_SESSION].hasMeshes) {
                    this[P_SESSION].updateTrackedMeshes(frame);
                }
                if (this[P_SESSION].hasDepth) {
                    this[P_SESSION].computeDepthSensing(frame);
                }
                if (this[P_SESSION].hasHitTest) {
                    this[P_SESSION].computeHitTestResults(frame);
                }
                this[P_SESSION].activeFrame = frame;
                this[P_SESSION].device[P_DEVICE].onFrameStart(frame);
                this[P_SESSION].updateActiveInputSources();
                /*
                 * For each entry in callbacks, in order:
                 * - If the entry’s cancelled boolean is true, continue to the next entry.
                 * - Invoke the Web IDL callback function, passing now and frame as the arguments.
                 * - If an exception is thrown, report the exception.
                 */
                // - Let callbacks be a list of the entries in session’s list of animation frame
                //   callback, in the order in which they were added to the list.
                const callbacks = (this[P_SESSION].currentFrameCallbacks =
                    this[P_SESSION].frameCallbacks);
                // - Set session’s list of animation frame callbacks to the empty list.
                this[P_SESSION].frameCallbacks = [];
                for (let i = 0; i < callbacks.length; i++) {
                    try {
                        if (!callbacks[i].cancelled) {
                            callbacks[i].callback(now, frame);
                        }
                    }
                    catch (err) {
                        console.error(err);
                    }
                }
                this[P_SESSION].currentFrameCallbacks = null;
                // - Set frame’s active boolean to false.
                frame[P_FRAME].active = false;
                this[P_SESSION].activeFrame = null;
            },
            nominalFrameRate: device.internalNominalFrameRate,
            referenceSpaces: [],
            inputSourceArray: [],
            activeInputSources: [],
            updateActiveInputSources: () => {
                const handTrackingOn = this[P_SESSION].enabledFeatures.includes('hand-tracking');
                const gazeTrackingOn = this[P_SESSION].hasGazeTracking;
                const prevInputs = this[P_SESSION].activeInputSources;
                const currInputs = this[P_SESSION].device.inputSources.filter((inputSource) => (!inputSource.hand || handTrackingOn) &&
                    (inputSource.targetRayMode !== 'gaze' || gazeTrackingOn));
                const added = currInputs.filter((item) => !prevInputs.includes(item));
                const removed = prevInputs.filter((item) => !currInputs.includes(item));
                this[P_SESSION].activeInputSources = currInputs;
                if (added.length > 0 || removed.length > 0) {
                    this.dispatchEvent(new XRInputSourcesChangeEvent('inputsourceschange', {
                        session: this,
                        added,
                        removed,
                    }));
                }
            },
            trackedAnchors: new XRAnchorSet(),
            persistentAnchors: new Map(),
            newAnchors: new Map(),
            frameTrackedAnchors: new XRAnchorSet(),
            updateTrackedAnchors: () => {
                if (this[P_SESSION].enabledFeatures.includes('anchors')) {
                    this[P_SESSION].frameTrackedAnchors.clear();
                    Array.from(this[P_SESSION].trackedAnchors).forEach((anchor) => {
                        if (anchor[P_ANCHOR].deleted) {
                            this[P_SESSION].trackedAnchors.delete(anchor);
                            if (this[P_SESSION].newAnchors.has(anchor)) {
                                const { reject } = this[P_SESSION].newAnchors.get(anchor);
                                reject(new DOMException('Anchor is no longer tracked', 'InvalidStateError'));
                            }
                        }
                        else {
                            this[P_SESSION].frameTrackedAnchors.add(anchor);
                            if (this[P_SESSION].newAnchors.has(anchor)) {
                                const { resolve } = this[P_SESSION].newAnchors.get(anchor);
                                resolve(anchor);
                                this[P_SESSION].newAnchors.delete(anchor);
                            }
                        }
                    });
                }
            },
            trackedPlanes: new Map(),
            updateTrackedPlanes: (frame) => {
                const sem = this[P_SESSION].device[P_DEVICE].sem;
                if (!sem) {
                    return;
                }
                const trackedPlanes = Array.from(this[P_SESSION].trackedPlanes.keys());
                trackedPlanes.forEach((plane) => {
                    if (!sem.trackedPlanes.has(plane)) {
                        this[P_SESSION].trackedPlanes.delete(plane);
                    }
                });
                sem.trackedPlanes.forEach((plane) => {
                    let xrPlane = this[P_SESSION].trackedPlanes.get(plane);
                    if (!xrPlane) {
                        const planeSpace = new XRSpace(this[P_SESSION].device[P_DEVICE].globalSpace, plane.transform.matrix);
                        xrPlane = new XRPlane(plane, planeSpace, plane.polygon, plane.semanticLabel);
                        this[P_SESSION].trackedPlanes.set(plane, xrPlane);
                    }
                    xrPlane[P_PLANE].lastChangedTime = frame.predictedDisplayTime;
                    xrPlane[P_PLANE].frame = frame;
                    frame[P_FRAME].detectedPlanes.add(xrPlane);
                });
            },
            trackedMeshes: new Map(),
            updateTrackedMeshes: (frame) => {
                const sem = this[P_SESSION].device[P_DEVICE].sem;
                if (!sem) {
                    return;
                }
                const trackedMeshes = Array.from(this[P_SESSION].trackedMeshes.keys());
                trackedMeshes.forEach((mesh) => {
                    if (!sem.trackedMeshes.has(mesh)) {
                        this[P_SESSION].trackedMeshes.delete(mesh);
                    }
                });
                sem.trackedMeshes.forEach((mesh) => {
                    let xrMesh = this[P_SESSION].trackedMeshes.get(mesh);
                    if (!xrMesh) {
                        const meshSpace = new XRSpace(this[P_SESSION].device[P_DEVICE].globalSpace, mesh.transform.matrix);
                        xrMesh = new XRMesh(mesh, meshSpace, mesh.vertices, mesh.indices, mesh.semanticLabel);
                        this[P_SESSION].trackedMeshes.set(mesh, xrMesh);
                    }
                    xrMesh[P_MESH].lastChangedTime = frame.predictedDisplayTime;
                    xrMesh[P_MESH].frame = frame;
                    frame[P_FRAME].detectedMeshes.add(xrMesh);
                });
            },
            depthSensingUsage: ((_b = (_a = _depthSensing === null || _depthSensing === void 0 ? void 0 : _depthSensing.usagePreference) === null || _a === void 0 ? void 0 : _a[0]) !== null && _b !== void 0 ? _b : 'cpu-optimized'),
            depthSensingDataFormat: 'float32',
            depthTexture: null,
            depthTextureWidth: 0,
            depthTextureHeight: 0,
            depthFlipScratch: null,
            depthFlipScratchSize: 0,
            activeFrame: null,
            computeDepthSensing: (frame) => {
                const sem = this[P_SESSION].device[P_DEVICE].sem;
                if (!sem)
                    return;
                const { depthNear, depthFar } = this[P_SESSION].renderState;
                const baseLayer = this[P_SESSION].renderState.baseLayer;
                if (!baseLayer)
                    return;
                const canvas = baseLayer.context.canvas;
                const depthWidth = Math.max(1, Math.floor(canvas.width / 4));
                const depthHeight = Math.max(1, Math.floor(canvas.height / 4));
                const eyes = this[P_SESSION].mode === 'inline'
                    ? [XREye.None]
                    : [XREye.Left, XREye.Right];
                const isGpuOptimized = this[P_SESSION].depthSensingUsage === 'gpu-optimized';
                for (const eye of eyes) {
                    const projectionMatrix = this[P_SESSION].getProjectionMatrix(eye);
                    const viewSpace = this[P_SESSION].device.viewSpaces[eye];
                    const viewGlobalMatrix = XRSpaceUtils.calculateGlobalOffsetMatrix(viewSpace);
                    const viewMatrix = create$5();
                    invert$1(viewMatrix, viewGlobalMatrix);
                    const result = sem.computeDepthBuffer(viewMatrix, projectionMatrix, depthWidth, depthHeight, depthNear, depthFar);
                    if (result) {
                        if (isGpuOptimized) {
                            // Provide GPU depth data (inverse depth in texture)
                            const gl = baseLayer.context;
                            const { width: dw, height: dh } = result;
                            const numLayers = 2;
                            if (!this[P_SESSION].depthTexture ||
                                this[P_SESSION].depthTextureWidth !== dw ||
                                this[P_SESSION].depthTextureHeight !== dh) {
                                if (this[P_SESSION].depthTexture) {
                                    gl.deleteTexture(this[P_SESSION].depthTexture);
                                }
                                this[P_SESSION].depthTexture = gl.createTexture();
                                gl.bindTexture(gl.TEXTURE_2D_ARRAY, this[P_SESSION].depthTexture);
                                gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.R32F, dw, dh, numLayers);
                                gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
                                gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
                                gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
                                gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
                                this[P_SESSION].depthTextureWidth = dw;
                                this[P_SESSION].depthTextureHeight = dh;
                            }
                            else {
                                gl.bindTexture(gl.TEXTURE_2D_ARRAY, this[P_SESSION].depthTexture);
                            }
                            const srcData = new Float32Array(result.data);
                            const flipSize = dw * dh;
                            if (!this[P_SESSION].depthFlipScratch ||
                                this[P_SESSION].depthFlipScratchSize !== flipSize) {
                                this[P_SESSION].depthFlipScratch = new Float32Array(flipSize);
                                this[P_SESSION].depthFlipScratchSize = flipSize;
                            }
                            const flippedData = this[P_SESSION].depthFlipScratch;
                            for (let row = 0; row < dh; row++) {
                                const srcRow = dh - 1 - row;
                                for (let col = 0; col < dw; col++) {
                                    const depthM = srcData[srcRow * dw + col];
                                    flippedData[row * dw + col] =
                                        depthM > 0 ? 1 - depthNear / depthM : 0;
                                }
                            }
                            const prevFlipY = gl.getParameter(gl.UNPACK_FLIP_Y_WEBGL);
                            const prevPremultiply = gl.getParameter(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL);
                            gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
                            gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
                            const layerIndex = eye === XREye.Right ? 1 : 0;
                            gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, layerIndex, dw, dh, 1, gl.RED, gl.FLOAT, flippedData);
                            gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, prevFlipY);
                            gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, prevPremultiply);
                            const gpuDepthInfo = new XRWebGLDepthInformation(this[P_SESSION].depthTexture, dw, dh, new XRRigidTransform(), result.rawValueToMeters, depthNear, depthFar, 'texture-array', layerIndex);
                            frame[P_FRAME].gpuDepthDataMap.set(eye, gpuDepthInfo);
                        }
                        else {
                            // Provide CPU depth data.
                            const cpuDepthInfo = new XRCPUDepthInformation(result.data, result.width, result.height, new XRRigidTransform(), result.rawValueToMeters, this[P_SESSION].depthSensingDataFormat);
                            frame[P_FRAME].depthDataMap.set(eye, cpuDepthInfo);
                        }
                    }
                }
            },
            hitTestSources: new Set(),
            computeHitTestResults: (frame) => {
                const sem = this[P_SESSION].device[P_DEVICE].sem;
                if (!sem)
                    return;
                const globalSpace = this[P_SESSION].device[P_DEVICE].globalSpace;
                this[P_SESSION].hitTestSources.forEach((hitTestSource) => {
                    const sourceSpace = hitTestSource[P_HIT_TEST].space;
                    const sourceGlobalOffset = XRSpaceUtils.calculateGlobalOffsetMatrix(sourceSpace);
                    const rayLocalOffset = hitTestSource[P_HIT_TEST].offsetRay.matrix;
                    const rayGlobalOffset = create$5();
                    multiply$2(rayGlobalOffset, sourceGlobalOffset, rayLocalOffset);
                    const hitTestResults = [];
                    sem.computeHitTestResults(rayGlobalOffset).forEach((matrix) => {
                        const offsetSpace = new XRSpace(globalSpace, matrix);
                        const hitTestResult = new XRHitTestResult(frame, offsetSpace);
                        hitTestResults.push(hitTestResult);
                    });
                    frame[P_FRAME].hitTestResultsMap.set(hitTestSource, hitTestResults);
                });
            },
            onend: null,
            oninputsourceschange: null,
            onselect: null,
            onselectstart: null,
            onselectend: null,
            onsqueeze: null,
            onsqueezestart: null,
            onsqueezeend: null,
            onvisibilitychange: null,
            onframeratechange: null,
        };
        XRAnchorUtils.recoverPersistentAnchorsFromStorage(this);
        // start the frameloop
        this[P_SESSION].onDeviceFrame();
    }
    get visibilityState() {
        return this[P_SESSION].device.visibilityState;
    }
    get frameRate() {
        return this[P_SESSION].nominalFrameRate;
    }
    get supportedFrameRates() {
        return this[P_SESSION].supportedFrameRates;
    }
    get renderState() {
        return this[P_SESSION].renderState;
    }
    get inputSources() {
        // use the same array object
        this[P_SESSION].inputSourceArray.length = 0;
        if (!this[P_SESSION].ended && this[P_SESSION].mode !== 'inline') {
            this[P_SESSION].inputSourceArray.push(...this[P_SESSION].activeInputSources);
        }
        return this[P_SESSION].inputSourceArray;
    }
    get enabledFeatures() {
        return this[P_SESSION].enabledFeatures;
    }
    get isSystemKeyboardSupported() {
        return this[P_SESSION].isSystemKeyboardSupported;
    }
    get environmentBlendMode() {
        var _a;
        return ((_a = this[P_SESSION].device[P_DEVICE].environmentBlendModes[this[P_SESSION].mode]) !== null && _a !== void 0 ? _a : XREnvironmentBlendMode.Opaque);
    }
    get interactionMode() {
        return this[P_SESSION].device[P_DEVICE].interactionMode;
    }
    get depthUsage() {
        return this[P_SESSION].depthSensingUsage;
    }
    get depthDataFormat() {
        return this[P_SESSION].depthSensingDataFormat;
    }
    updateRenderState(state = {}) {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m;
        if (this[P_SESSION].ended) {
            throw new DOMException('XRSession has already ended.', 'InvalidStateError');
        }
        if (state.baseLayer && state.baseLayer[P_WEBGL_LAYER].session !== this) {
            throw new DOMException('Base layer was created by a different XRSession', 'InvalidStateError');
        }
        if (state.inlineVerticalFieldOfView != null &&
            this[P_SESSION].mode !== 'inline') {
            throw new DOMException('InlineVerticalFieldOfView must not be set for an immersive session', 'InvalidStateError');
        }
        const compoundStateInit = {
            // Use nullish coalescing so legitimate 0 values (e.g.
            // inlineVerticalFieldOfView=0) are preserved instead of being dropped.
            baseLayer: (_c = (_a = state.baseLayer) !== null && _a !== void 0 ? _a : (_b = this[P_SESSION].pendingRenderState) === null || _b === void 0 ? void 0 : _b.baseLayer) !== null && _c !== void 0 ? _c : undefined,
            depthFar: (_f = (_d = state.depthFar) !== null && _d !== void 0 ? _d : (_e = this[P_SESSION].pendingRenderState) === null || _e === void 0 ? void 0 : _e.depthFar) !== null && _f !== void 0 ? _f : undefined,
            depthNear: (_j = (_g = state.depthNear) !== null && _g !== void 0 ? _g : (_h = this[P_SESSION].pendingRenderState) === null || _h === void 0 ? void 0 : _h.depthNear) !== null && _j !== void 0 ? _j : undefined,
            inlineVerticalFieldOfView: (_m = (_k = state.inlineVerticalFieldOfView) !== null && _k !== void 0 ? _k : (_l = this[P_SESSION].pendingRenderState) === null || _l === void 0 ? void 0 : _l.inlineVerticalFieldOfView) !== null && _m !== void 0 ? _m : undefined,
        };
        this[P_SESSION].pendingRenderState = new XRRenderState(compoundStateInit, this[P_SESSION].renderState);
    }
    // the nominal frame rate updates are emulated, no actual update to the
    // display frame rate of the device will be executed
    async updateTargetFrameRate(rate) {
        return new Promise((resolve, reject) => {
            if (this[P_SESSION].ended) {
                reject(new DOMException('XRSession has already ended.', 'InvalidStateError'));
            }
            else if (!this[P_SESSION].device.supportedFrameRates.includes(rate)) {
                reject(new DOMException('Requested frame rate not supported.', 'InvalidStateError'));
            }
            else {
                if (this[P_SESSION].nominalFrameRate === rate) {
                    console.log(`Requested frame rate is the same as the current nominal frame rate, no update made`);
                }
                else {
                    this[P_SESSION].nominalFrameRate = rate;
                    this.dispatchEvent(new XRSessionEvent('frameratechange', { session: this }));
                    console.log(`Nominal frame rate updated to ${rate}`);
                }
                resolve();
            }
        });
    }
    async requestReferenceSpace(type) {
        return new Promise((resolve, reject) => {
            if (this[P_SESSION].ended ||
                !this[P_SESSION].referenceSpaceIsSupported(type)) {
                reject(new DOMException('The requested reference space type is not supported.', 'NotSupportedError'));
                return;
            }
            let referenceSpace;
            switch (type) {
                case XRReferenceSpaceType.Viewer:
                    referenceSpace = this[P_SESSION].device.viewerSpace;
                    break;
                case XRReferenceSpaceType.Local:
                    // creating an XRReferenceSpace with the current headset transform in global space
                    referenceSpace = new XRReferenceSpace(type, this[P_SESSION].device[P_DEVICE].globalSpace, this[P_SESSION].device.viewerSpace[P_SPACE].offsetMatrix);
                    break;
                case XRReferenceSpaceType.LocalFloor:
                case XRReferenceSpaceType.BoundedFloor:
                case XRReferenceSpaceType.Unbounded:
                    // TO-DO: add boundary geometry for bounded-floor
                    referenceSpace = new XRReferenceSpace(type, this[P_SESSION].device[P_DEVICE].globalSpace);
                    break;
            }
            this[P_SESSION].referenceSpaces.push(referenceSpace);
            resolve(referenceSpace);
        });
    }
    requestAnimationFrame(callback) {
        if (this[P_SESSION].ended) {
            return 0;
        }
        const frameHandle = ++this[P_SESSION].frameHandle;
        this[P_SESSION].frameCallbacks.push({
            handle: frameHandle,
            callback,
            cancelled: false,
        });
        return frameHandle;
    }
    cancelAnimationFrame(handle) {
        // Remove the callback with that handle from the queue
        let callbacks = this[P_SESSION].frameCallbacks;
        let index = callbacks.findIndex((d) => d && d.handle === handle);
        if (index > -1) {
            callbacks[index].cancelled = true;
            callbacks.splice(index, 1);
        }
        // If cancelAnimationFrame is called from within a frame callback, also check
        // the remaining callbacks for the current frame:
        callbacks = this[P_SESSION].currentFrameCallbacks;
        if (callbacks) {
            index = callbacks.findIndex((d) => d && d.handle === handle);
            if (index > -1) {
                callbacks[index].cancelled = true;
                // Rely on cancelled flag only; don't mutate this array while it's being iterated
            }
        }
    }
    async end() {
        return new Promise((resolve, reject) => {
            var _a;
            if (this[P_SESSION].ended) {
                reject(new DOMException('XRSession has already ended.', 'InvalidStateError'));
            }
            else {
                // Mark the session as ended so the device frameloop early-returns and
                // requestAnimationFrame/updateRenderState behave per spec after end.
                this[P_SESSION].ended = true;
                globalThis.cancelAnimationFrame(this[P_SESSION].deviceFrameHandle);
                this[P_SESSION].deviceFrameHandle = undefined;
                this[P_SESSION].device[P_DEVICE].onSessionEnd();
                // Tear down per-session state so it doesn't dangle after end.
                this[P_SESSION].frameCallbacks.length = 0;
                this[P_SESSION].currentFrameCallbacks = null;
                this[P_SESSION].referenceSpaces.length = 0;
                this[P_SESSION].hitTestSources.clear();
                this[P_SESSION].trackedPlanes.clear();
                this[P_SESSION].trackedMeshes.clear();
                // Per-session tracked anchors only; persistentAnchors survive by design.
                this[P_SESSION].trackedAnchors.clear();
                this[P_SESSION].frameTrackedAnchors.clear();
                // Reject any pending anchor-creation promises so they don't dangle.
                this[P_SESSION].newAnchors.forEach(({ reject: rejectAnchor }) => {
                    rejectAnchor(new DOMException('XRSession has ended before the anchor was resolved.', 'InvalidStateError'));
                });
                this[P_SESSION].newAnchors.clear();
                // Release the depth texture via the base layer context, if any.
                if (this[P_SESSION].depthTexture) {
                    const depthContext = (_a = this[P_SESSION].renderState.baseLayer) === null || _a === void 0 ? void 0 : _a.context;
                    depthContext === null || depthContext === void 0 ? void 0 : depthContext.deleteTexture(this[P_SESSION].depthTexture);
                    this[P_SESSION].depthTexture = null;
                }
                this.dispatchEvent(new XRSessionEvent('end', { session: this }));
                resolve();
            }
        });
    }
    // anchors
    get persistentAnchors() {
        return Array.from(this[P_SESSION].persistentAnchors.keys());
    }
    restorePersistentAnchor(uuid) {
        return new Promise((resolve, reject) => {
            if (!this[P_SESSION].persistentAnchors.has(uuid)) {
                reject(new DOMException(`Persistent anchor with uuid ${uuid} not found.`, 'InvalidStateError'));
            }
            else if (this[P_SESSION].ended) {
                reject(new DOMException('XRSession has already ended.', 'InvalidStateError'));
            }
            else {
                const anchor = this[P_SESSION].persistentAnchors.get(uuid);
                if (this[P_SESSION].newAnchors.has(anchor)) {
                    reject(new DOMException(`Multiple concurrent attempts detected to restore the anchor with UUID: ${uuid}.`, 'InvalidStateError'));
                }
                else {
                    this[P_SESSION].trackedAnchors.add(anchor);
                    this[P_SESSION].newAnchors.set(anchor, { resolve, reject });
                }
            }
        });
    }
    deletePersistentAnchor(uuid) {
        return new Promise((resolve, reject) => {
            if (!this[P_SESSION].persistentAnchors.has(uuid)) {
                reject(new DOMException(`Persistent anchor with uuid ${uuid} not found.`, 'InvalidStateError'));
            }
            else {
                const anchor = this[P_SESSION].persistentAnchors.get(uuid);
                this[P_SESSION].persistentAnchors.delete(uuid);
                anchor.delete();
                resolve(undefined);
            }
        });
    }
    requestHitTestSource(options) {
        return new Promise((resolve, reject) => {
            if (!this[P_SESSION].enabledFeatures.includes('hit-test')) {
                reject(new DOMException(`WebXR feature "hit-test" is not supported by current session`, 'NotSupportedError'));
            }
            else if (this[P_SESSION].ended) {
                reject(new DOMException('XRSession has already ended.', 'InvalidStateError'));
            }
            else if (!this[P_SESSION].device[P_DEVICE].sem) {
                reject(new DOMException('Synthethic Environment Module required for emulating hit-test', 'OperationError'));
            }
            else {
                const xrHitTestSource = new XRHitTestSource(this, options);
                this[P_SESSION].hitTestSources.add(xrHitTestSource);
                resolve(xrHitTestSource);
            }
        });
    }
    // events
    get onend() {
        return this[P_SESSION].onend;
    }
    set onend(callback) {
        if (this[P_SESSION].onend) {
            this.removeEventListener('end', this[P_SESSION].onend);
        }
        this[P_SESSION].onend = callback;
        if (callback) {
            this.addEventListener('end', callback);
        }
    }
    get oninputsourceschange() {
        return this[P_SESSION].oninputsourceschange;
    }
    set oninputsourceschange(callback) {
        if (this[P_SESSION].oninputsourceschange) {
            this.removeEventListener('inputsourceschange', this[P_SESSION].oninputsourceschange);
        }
        this[P_SESSION].oninputsourceschange = callback;
        if (callback) {
            this.addEventListener('inputsourceschange', callback);
        }
    }
    get onselect() {
        return this[P_SESSION].onselect;
    }
    set onselect(callback) {
        if (this[P_SESSION].onselect) {
            this.removeEventListener('select', this[P_SESSION].onselect);
        }
        this[P_SESSION].onselect = callback;
        if (callback) {
            this.addEventListener('select', callback);
        }
    }
    get onselectstart() {
        return this[P_SESSION].onselectstart;
    }
    set onselectstart(callback) {
        if (this[P_SESSION].onselectstart) {
            this.removeEventListener('selectstart', this[P_SESSION].onselectstart);
        }
        this[P_SESSION].onselectstart = callback;
        if (callback) {
            this.addEventListener('selectstart', callback);
        }
    }
    get onselectend() {
        return this[P_SESSION].onselectend;
    }
    set onselectend(callback) {
        if (this[P_SESSION].onselectend) {
            this.removeEventListener('selectend', this[P_SESSION].onselectend);
        }
        this[P_SESSION].onselectend = callback;
        if (callback) {
            this.addEventListener('selectend', callback);
        }
    }
    get onsqueeze() {
        return this[P_SESSION].onsqueeze;
    }
    set onsqueeze(callback) {
        if (this[P_SESSION].onsqueeze) {
            this.removeEventListener('squeeze', this[P_SESSION].onsqueeze);
        }
        this[P_SESSION].onsqueeze = callback;
        if (callback) {
            this.addEventListener('squeeze', callback);
        }
    }
    get onsqueezestart() {
        return this[P_SESSION].onsqueezestart;
    }
    set onsqueezestart(callback) {
        if (this[P_SESSION].onsqueezestart) {
            this.removeEventListener('squeezestart', this[P_SESSION].onsqueezestart);
        }
        this[P_SESSION].onsqueezestart = callback;
        if (callback) {
            this.addEventListener('squeezestart', callback);
        }
    }
    get onsqueezeend() {
        return this[P_SESSION].onsqueezeend;
    }
    set onsqueezeend(callback) {
        if (this[P_SESSION].onsqueezeend) {
            this.removeEventListener('squeezeend', this[P_SESSION].onsqueezeend);
        }
        this[P_SESSION].onsqueezeend = callback;
        if (callback) {
            this.addEventListener('squeezeend', callback);
        }
    }
    get onvisibilitychange() {
        return this[P_SESSION].onvisibilitychange;
    }
    set onvisibilitychange(callback) {
        if (this[P_SESSION].onvisibilitychange) {
            this.removeEventListener('visibilitychange', this[P_SESSION].onvisibilitychange);
        }
        this[P_SESSION].onvisibilitychange = callback;
        if (callback) {
            this.addEventListener('visibilitychange', callback);
        }
    }
    get onframeratechange() {
        return this[P_SESSION].onframeratechange;
    }
    set onframeratechange(callback) {
        if (this[P_SESSION].onframeratechange) {
            this.removeEventListener('frameratechange', this[P_SESSION].onframeratechange);
        }
        this[P_SESSION].onframeratechange = callback;
        if (callback) {
            this.addEventListener('frameratechange', callback);
        }
    }
}

/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
var XRHandJoint;
(function (XRHandJoint) {
    XRHandJoint["Wrist"] = "wrist";
    XRHandJoint["ThumbMetacarpal"] = "thumb-metacarpal";
    XRHandJoint["ThumbPhalanxProximal"] = "thumb-phalanx-proximal";
    XRHandJoint["ThumbPhalanxDistal"] = "thumb-phalanx-distal";
    XRHandJoint["ThumbTip"] = "thumb-tip";
    XRHandJoint["IndexFingerMetacarpal"] = "index-finger-metacarpal";
    XRHandJoint["IndexFingerPhalanxProximal"] = "index-finger-phalanx-proximal";
    XRHandJoint["IndexFingerPhalanxIntermediate"] = "index-finger-phalanx-intermediate";
    XRHandJoint["IndexFingerPhalanxDistal"] = "index-finger-phalanx-distal";
    XRHandJoint["IndexFingerTip"] = "index-finger-tip";
    XRHandJoint["MiddleFingerMetacarpal"] = "middle-finger-metacarpal";
    XRHandJoint["MiddleFingerPhalanxProximal"] = "middle-finger-phalanx-proximal";
    XRHandJoint["MiddleFingerPhalanxIntermediate"] = "middle-finger-phalanx-intermediate";
    XRHandJoint["MiddleFingerPhalanxDistal"] = "middle-finger-phalanx-distal";
    XRHandJoint["MiddleFingerTip"] = "middle-finger-tip";
    XRHandJoint["RingFingerMetacarpal"] = "ring-finger-metacarpal";
    XRHandJoint["RingFingerPhalanxProximal"] = "ring-finger-phalanx-proximal";
    XRHandJoint["RingFingerPhalanxIntermediate"] = "ring-finger-phalanx-intermediate";
    XRHandJoint["RingFingerPhalanxDistal"] = "ring-finger-phalanx-distal";
    XRHandJoint["RingFingerTip"] = "ring-finger-tip";
    XRHandJoint["PinkyFingerMetacarpal"] = "pinky-finger-metacarpal";
    XRHandJoint["PinkyFingerPhalanxProximal"] = "pinky-finger-phalanx-proximal";
    XRHandJoint["PinkyFingerPhalanxIntermediate"] = "pinky-finger-phalanx-intermediate";
    XRHandJoint["PinkyFingerPhalanxDistal"] = "pinky-finger-phalanx-distal";
    XRHandJoint["PinkyFingerTip"] = "pinky-finger-tip";
})(XRHandJoint || (XRHandJoint = {}));
class XRHand extends Map {
}

/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
class XRJointSpace extends XRSpace {
    constructor(jointName, parentSpace, offsetMatrix) {
        super(parentSpace, offsetMatrix);
        this[P_JOINT_SPACE] = { jointName, radius: 0 };
    }
    get jointName() {
        return this[P_JOINT_SPACE].jointName;
    }
}

/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
const pinchHandPose = {
    jointTransforms: {
        wrist: {
            offsetMatrix: [
                0.9060805439949036, -0.1844543218612671, 0.3807799518108368, 0,
                -0.08027800172567368, 0.8086723685264587, 0.5827555656433105, 0,
                -0.4154181182384491, -0.5585917234420776, 0.7179155349731445, 0,
                -0.06867414712905884, -0.009423808194696903, 0.10627774149179459, 1,
            ],
            radius: 0.021460847929120064,
        },
        'thumb-metacarpal': {
            offsetMatrix: [
                -0.5012241005897522, -0.8650535345077515, -0.0213695727288723, 0,
                0.7415963411331177, -0.4421543478965759, 0.5045139193534851, 0,
                -0.44587990641593933, 0.23702676594257355, 0.8631392121315002, 0,
                -0.032122574746608734, -0.01196830440312624, 0.07194234430789948, 1,
            ],
            radius: 0.019382517784833908,
        },
        'thumb-phalanx-proximal': {
            offsetMatrix: [
                -0.3175753057003021, -0.9460570216178894, -0.06419729441404343, 0,
                0.8958902955055237, -0.32153913378715515, 0.30658137798309326, 0,
                -0.3106854259967804, 0.03984907269477844, 0.9496771097183228, 0,
                -0.017625702545046806, -0.01967475935816765, 0.04387917369604111, 1,
            ],
            radius: 0.01228295173496008,
        },
        'thumb-phalanx-distal': {
            offsetMatrix: [
                -0.4944636821746826, -0.8691971898078918, 0.001086252392269671, 0,
                0.8307800889015198, -0.4722411036491394, 0.2946045398712158, 0,
                -0.25555649399757385, 0.14657381176948547, 0.9556186199188232, 0,
                -0.007126678712666035, -0.021021386608481407, 0.011786630377173424, 1,
            ],
            radius: 0.009768804535269737,
        },
        'thumb-tip': {
            offsetMatrix: [
                -0.4944636821746826, -0.8691971898078918, 0.001086252392269671, 0,
                0.8307800889015198, -0.4722411036491394, 0.2946045398712158, 0,
                -0.25555649399757385, 0.14657381176948547, 0.9556186199188232, 0,
                0.0003423091256991029, -0.024528030306100845, -0.011410919018089771, 1,
            ],
            radius: 0.008768804371356964,
        },
        'index-finger-metacarpal': {
            offsetMatrix: [
                0.9060805439949036, -0.1844543218612671, 0.3807799518108368, 0,
                -0.08027800172567368, 0.8086723685264587, 0.5827555656433105, 0,
                -0.4154181182384491, -0.5585917234420776, 0.7179155349731445, 0,
                -0.038037415593862534, -0.0020236473064869642, 0.07626739144325256, 1,
            ],
            radius: 0.021228281781077385,
        },
        'index-finger-phalanx-proximal': {
            offsetMatrix: [
                0.7986818552017212, -0.35985732078552246, 0.48229536414146423, 0,
                0.538311243057251, 0.7854709625244141, -0.30537736415863037, 0,
                -0.2689369022846222, 0.5035246014595032, 0.8210577368736267, 0,
                -0.006869405973702669, 0.033938243985176086, 0.04206443578004837, 1,
            ],
            radius: 0.010295259766280651,
        },
        'index-finger-phalanx-intermediate': {
            offsetMatrix: [
                0.8285930156707764, -0.32672837376594543, 0.4546217918395996, 0,
                0.5577570199966431, 0.4116027057170868, -0.7207564115524292, 0,
                0.04836784675717354, 0.8507823944091797, 0.5232869386672974, 0,
                0.0033306588884443045, 0.014840902760624886, 0.010923954658210278, 1,
            ],
            radius: 0.00853810179978609,
        },
        'index-finger-phalanx-distal': {
            offsetMatrix: [
                0.8412464261054993, -0.35794928669929504, 0.4051857888698578, 0,
                0.5139996409416199, 0.29711154103279114, -0.8046918511390686, 0,
                0.16765329241752625, 0.8852096796035767, 0.4339304566383362, 0,
                0.0021551470272243023, -0.0058362227864563465, -0.0017938464879989624,
                1,
            ],
            radius: 0.007636196445673704,
        },
        'index-finger-tip': {
            offsetMatrix: [
                0.8412464261054993, -0.35794928669929504, 0.4051857888698578, 0,
                0.5139996409416199, 0.29711154103279114, -0.8046918511390686, 0,
                0.16765329241752625, 0.8852096796035767, 0.4339304566383362, 0,
                -0.00131594471167773, -0.025222131982445717, -0.012442642822861671, 1,
            ],
            radius: 0.006636196281760931,
        },
        'middle-finger-metacarpal': {
            offsetMatrix: [
                0.9060805439949036, -0.1844543218612671, 0.3807799518108368, 0,
                -0.08027800172567368, 0.8086723685264587, 0.5827555656433105, 0,
                -0.4154181182384491, -0.5585917234420776, 0.7179155349731445, 0,
                -0.05395089089870453, 0.003063359996303916, 0.07402937114238739, 1,
            ],
            radius: 0.021231964230537415,
        },
        'middle-finger-phalanx-proximal': {
            offsetMatrix: [
                0.9187911748886108, -0.1530158370733261, 0.36387869715690613, 0,
                0.038666240870952606, 0.9522662162780762, 0.302808940410614, 0,
                -0.3928440511226654, -0.26414817571640015, 0.8808513283729553, 0,
                -0.02717282809317112, 0.04162866622209549, 0.03678669035434723, 1,
            ],
            radius: 0.01117393933236599,
        },
        'middle-finger-phalanx-intermediate': {
            offsetMatrix: [
                0.9228746294975281, -0.12856416404247284, 0.36300456523895264, 0,
                0.14524033665657043, 0.9892153143882751, -0.01890045404434204, 0,
                -0.3566599190235138, 0.07016586512327194, 0.9315956234931946, 0,
                -0.01030921470373869, 0.05296773463487625, -0.0010256498353555799, 1,
            ],
            radius: 0.008030958473682404,
        },
        'middle-finger-phalanx-distal': {
            offsetMatrix: [
                0.9325166344642639, -0.040404170751571655, 0.35885775089263916, 0,
                0.06836572289466858, 0.995502769947052, -0.0655682161450386, 0,
                -0.3545948565006256, 0.08567725121974945, 0.9310863614082336, 0,
                -4833847051486373e-19, 0.05103470757603645, -0.026690717786550522, 1,
            ],
            radius: 0.007629410829395056,
        },
        'middle-finger-tip': {
            offsetMatrix: [
                0.9325166344642639, -0.040404170751571655, 0.35885775089263916, 0,
                0.06836572289466858, 0.995502769947052, -0.0655682161450386, 0,
                -0.3545948565006256, 0.08567725121974945, 0.9310863614082336, 0,
                0.008158999495208263, 0.05004044249653816, -0.050120558589696884, 1,
            ],
            radius: 0.006629410665482283,
        },
        'ring-finger-metacarpal': {
            offsetMatrix: [
                0.9060805439949036, -0.1844543218612671, 0.3807799518108368, 0,
                -0.08027800172567368, 0.8086723685264587, 0.5827555656433105, 0,
                -0.4154181182384491, -0.5585917234420776, 0.7179155349731445, 0,
                -0.06732909381389618, 0.007902119308710098, 0.07209732383489609, 1,
            ],
            radius: 0.019088275730609894,
        },
        'ring-finger-phalanx-proximal': {
            offsetMatrix: [
                0.9391821026802063, -0.027994679287075996, 0.34227466583251953, 0,
                -0.18282271921634674, 0.8029410243034363, 0.5673282742500305, 0,
                -0.2907087206840515, -0.5954000353813171, 0.7489906549453735, 0,
                -0.047129884362220764, 0.03806127607822418, 0.032147664576768875, 1,
            ],
            radius: 0.00992213748395443,
        },
        'ring-finger-phalanx-intermediate': {
            offsetMatrix: [
                0.9249380826950073, 0.03699534013867378, 0.3783116042613983, 0,
                -0.12898847460746765, 0.9667453765869141, 0.2208271026611328, 0,
                -0.3575615882873535, -0.25304901599884033, 0.8989526629447937, 0,
                -0.03579339757561684, 0.06127955764532089, 0.002939916681498289, 1,
            ],
            radius: 0.007611672393977642,
        },
        'ring-finger-phalanx-distal': {
            offsetMatrix: [
                0.9001164436340332, 0.03983335196971893, 0.4338230490684509, 0,
                -0.09662467986345291, 0.9892624020576477, 0.10964841395616531, 0,
                -0.4247973561286926, -0.14061418175697327, 0.8943013548851013, 0,
                -0.026291755959391594, 0.06800390034914017, -0.02094830758869648, 1,
            ],
            radius: 0.007231088820844889,
        },
        'ring-finger-tip': {
            offsetMatrix: [
                0.9001164436340332, 0.03983335196971893, 0.4338230490684509, 0,
                -0.09662467986345291, 0.9892624020576477, 0.10964841395616531, 0,
                -0.4247973561286926, -0.14061418175697327, 0.8943013548851013, 0,
                -0.016345610842108727, 0.07300511747598648, -0.04263874143362045, 1,
            ],
            radius: 0.0062310886569321156,
        },
        'pinky-finger-metacarpal': {
            offsetMatrix: [
                0.8769711852073669, 0.31462907791137695, 0.36322021484375, 0,
                -0.4506046175956726, 0.801031768321991, 0.39408499002456665, 0,
                -0.16696058213710785, -0.5092697143554688, 0.8442559838294983, 0,
                -0.07460174709558487, 0.0062340241856873035, 0.06756893545389175, 1,
            ],
            radius: 0.01808827556669712,
        },
        'pinky-finger-phalanx-proximal': {
            offsetMatrix: [
                0.9498357176780701, 0.1553308218717575, 0.2714462876319885, 0,
                -0.3019258379936218, 0.6817675232887268, 0.6663586497306824, 0,
                -0.08155745267868042, -0.7148879170417786, 0.694466233253479, 0,
                -0.06697750836610794, 0.029482364654541016, 0.02902858518064022, 1,
            ],
            radius: 0.008483353070914745,
        },
        'pinky-finger-phalanx-intermediate': {
            offsetMatrix: [
                0.9214097261428833, 0.27928245067596436, 0.2701927423477173, 0,
                -0.3670244514942169, 0.8538867831230164, 0.36901235580444336, 0,
                -0.12765564024448395, -0.43917882442474365, 0.8892839550971985, 0,
                -0.06447203457355499, 0.05144399777054787, 0.0076942890882492065, 1,
            ],
            radius: 0.0067641944624483585,
        },
        'pinky-finger-phalanx-distal': {
            offsetMatrix: [
                0.9038633704185486, 0.23618005216121674, 0.3567195236682892, 0,
                -0.3532794713973999, 0.8823202252388, 0.3109731376171112, 0,
                -0.24129553139209747, -0.4070987403392792, 0.8809353709220886, 0,
                -0.06187915802001953, 0.060364335775375366, -0.010368337854743004, 1,
            ],
            radius: 0.0064259846694767475,
        },
        'pinky-finger-tip': {
            offsetMatrix: [
                0.9038633704185486, 0.23618005216121674, 0.3567195236682892, 0,
                -0.3532794713973999, 0.8823202252388, 0.3109731376171112, 0,
                -0.24129553139209747, -0.4070987403392792, 0.8809353709220886, 0,
                -0.056796226650476456, 0.07042007893323898, -0.02921444922685623, 1,
            ],
            radius: 0.005425984505563974,
        },
    },
    gripOffsetMatrix: [
        0.08027800917625427, -0.8086723685264587, -0.5827556252479553, 0,
        -0.4154181480407715, -0.5585916638374329, 0.7179154753684998, 0,
        -0.9060805439949036, 0.1844543218612671, -0.3807799518108368, 0,
        -0.038054611533880234, -0.002910431008785963, 0.03720742464065552, 1,
    ],
};

/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
const pointHandPose = {
    jointTransforms: {
        wrist: {
            offsetMatrix: [
                0.9340395331382751, -0.13936476409435272, 0.32885703444480896, 0,
                -0.005510995630174875, 0.914999783039093, 0.40341612696647644, 0,
                -0.3571262061595917, -0.37861889600753784, 0.8538784384727478, 0,
                -0.05789132043719292, 0.01670890860259533, 0.11183350533246994, 1,
            ],
            radius: 0.021460847929120064,
        },
        'thumb-metacarpal': {
            offsetMatrix: [
                0.02145560085773468, -0.9978390336036682, 0.0621047280728817, 0,
                0.41311800479888916, 0.06541631370782852, 0.9083252549171448, 0,
                -0.9104245901107788, 0.006167683284729719, 0.4136286973953247, 0,
                -0.016488194465637207, 0.012708572670817375, 0.08862338215112686, 1,
            ],
            radius: 0.019382517784833908,
        },
        'thumb-phalanx-proximal': {
            offsetMatrix: [
                0.21270370483398438, -0.966137707233429, 0.14606566727161407, 0,
                0.49890995025634766, 0.2359165996313095, 0.8339261412620544, 0,
                -0.8401462435722351, -0.10450579971075058, 0.5321959853172302, 0,
                0.013112368993461132, 0.012508046813309193, 0.07517509907484055, 1,
            ],
            radius: 0.01228295173496008,
        },
        'thumb-phalanx-distal': {
            offsetMatrix: [
                0.01653280481696129, -0.9986647963523865, 0.048943229019641876, 0,
                0.26313456892967224, 0.051570065319538116, 0.9633802771568298, 0,
                -0.9646173715591431, -0.0030490627977997065, 0.26363563537597656, 0,
                0.04150351136922836, 0.016039609909057617, 0.05719054117798805, 1,
            ],
            radius: 0.009768804535269737,
        },
        'thumb-tip': {
            offsetMatrix: [
                0.01653280481696129, -0.9986647963523865, 0.048943229019641876, 0,
                0.26313456892967224, 0.051570065319538116, 0.9633802771568298, 0,
                -0.9646173715591431, -0.0030490627977997065, 0.26363563537597656, 0,
                0.06548332422971725, 0.01683700829744339, 0.0516640841960907, 1,
            ],
            radius: 0.008768804371356964,
        },
        'index-finger-metacarpal': {
            offsetMatrix: [
                0.9340395331382751, -0.13936476409435272, 0.32885703444480896, 0,
                -0.005510995630174875, 0.914999783039093, 0.40341612696647644, 0,
                -0.3571262061595917, -0.37861889600753784, 0.8538784384727478, 0,
                -0.02592567168176174, 0.019982583820819855, 0.08479326963424683, 1,
            ],
            radius: 0.021228281781077385,
        },
        'index-finger-phalanx-proximal': {
            offsetMatrix: [
                0.9063700437545776, -0.21756279468536377, 0.3621589243412018, 0,
                0.0970839336514473, 0.9415287375450134, 0.3226419687271118, 0,
                -0.41117796301841736, -0.2572731077671051, 0.8744958639144897, 0,
                -0.0015709538711234927, 0.043078210204839706, 0.034657616168260574, 1,
            ],
            radius: 0.010295259766280651,
        },
        'index-finger-phalanx-intermediate': {
            offsetMatrix: [
                0.9159826040267944, -0.1651475727558136, 0.36565208435058594, 0,
                0.09755707532167435, 0.9756820797920227, 0.1962820291519165, 0,
                -0.3891757130622864, -0.14411886036396027, 0.9098196625709534, 0,
                0.014023927971720695, 0.052835866808891296, 0.0014903299743309617, 1,
            ],
            radius: 0.00853810179978609,
        },
        'index-finger-phalanx-distal': {
            offsetMatrix: [
                0.9378057718276978, -0.12329639494419098, 0.3245268166065216, 0,
                0.032558172941207886, 0.9619227051734924, 0.2713746726512909, 0,
                -0.3456292748451233, -0.2439306229352951, 0.9061115384101868, 0,
                0.023482320830225945, 0.05633850023150444, -0.020621655508875847, 1,
            ],
            radius: 0.007636196445673704,
        },
        'index-finger-tip': {
            offsetMatrix: [
                0.9378057718276978, -0.12329639494419098, 0.3245268166065216, 0,
                0.032558172941207886, 0.9619227051734924, 0.2713746726512909, 0,
                -0.3456292748451233, -0.2439306229352951, 0.9061115384101868, 0,
                0.03096788562834263, 0.06281610578298569, -0.040703095495700836, 1,
            ],
            radius: 0.006636196281760931,
        },
        'middle-finger-metacarpal': {
            offsetMatrix: [
                0.9340395331382751, -0.13936476409435272, 0.32885703444480896, 0,
                -0.005510995630174875, 0.914999783039093, 0.40341612696647644, 0,
                -0.3571262061595917, -0.37861889600753784, 0.8538784384727478, 0,
                -0.04184452444314957, 0.022474845871329308, 0.08177298307418823, 1,
            ],
            radius: 0.021231964230537415,
        },
        'middle-finger-phalanx-proximal': {
            offsetMatrix: [
                0.9720265865325928, -0.08313076198101044, 0.21966552734375, 0,
                0.20477405190467834, 0.7580050826072693, -0.6192700862884521, 0,
                -0.11502730846405029, 0.6469289064407349, 0.7538246512413025, 0,
                -0.022107340395450592, 0.05035499855875969, 0.02970452979207039, 1,
            ],
            radius: 0.01117393933236599,
        },
        'middle-finger-phalanx-intermediate': {
            offsetMatrix: [
                0.9779140949249268, -0.07129573822021484, 0.19646917283535004, 0,
                0.1287083923816681, -0.5352076292037964, -0.8348574042320251, 0,
                0.1646735966205597, 0.8417060971260071, -0.5142109394073486, 0,
                -0.017169542610645294, 0.022584279999136925, -0.00265491777099669, 1,
            ],
            radius: 0.008030958473682404,
        },
        'middle-finger-phalanx-distal': {
            offsetMatrix: [
                0.9774913787841797, -0.19657190144062042, 0.07661263644695282, 0,
                -0.1924918293952942, -0.9796126484870911, -0.05749811604619026, 0,
                0.08635343611240387, 0.041456472128629684, -0.995401918888092, 0,
                -0.02170622907578945, -6043742760084569e-19, 0.011511396616697311, 1,
            ],
            radius: 0.007629410829395056,
        },
        'middle-finger-tip': {
            offsetMatrix: [
                0.9774913787841797, -0.19657190144062042, 0.07661263644695282, 0,
                -0.1924918293952942, -0.9796126484870911, -0.05749811604619026, 0,
                0.08635343611240387, 0.041456472128629684, -0.995401918888092, 0,
                -0.02438267692923546, -0.0026927536819130182, 0.03627248480916023, 1,
            ],
            radius: 0.006629410665482283,
        },
        'ring-finger-metacarpal': {
            offsetMatrix: [
                0.9340395331382751, -0.13936476409435272, 0.32885703444480896, 0,
                -0.005510995630174875, 0.914999783039093, 0.40341612696647644, 0,
                -0.3571262061595917, -0.37861889600753784, 0.8538784384727478, 0,
                -0.05944233387708664, 0.0264605600386858, 0.07478221505880356, 1,
            ],
            radius: 0.019088275730609894,
        },
        'ring-finger-phalanx-proximal': {
            offsetMatrix: [
                0.9842101335525513, 0.024470895528793335, 0.1753024309873581, 0,
                0.12200043350458145, 0.6237703561782837, -0.7720272541046143, 0,
                -0.12824076414108276, 0.7812241315841675, 0.610936164855957, 0,
                -0.04249368980526924, 0.0467497780919075, 0.027722163125872612, 1,
            ],
            radius: 0.00992213748395443,
        },
        'ring-finger-phalanx-intermediate': {
            offsetMatrix: [
                0.9941774606704712, 0.05949164181947708, 0.08983955532312393, 0,
                0.10504482686519623, -0.7208291888237, -0.6851072907447815, 0,
                0.024001073092222214, 0.6905553936958313, -0.7228817939758301, 0,
                -0.0374927744269371, 0.016285063698887825, 0.0038980208337306976, 1,
            ],
            radius: 0.007611672393977642,
        },
        'ring-finger-phalanx-distal': {
            offsetMatrix: [
                0.9995742440223694, 0.01638498157262802, 0.02412819117307663, 0,
                0.007813597097992897, -0.9474818110466003, 0.31971633434295654, 0,
                0.028100071474909782, -0.31939181685447693, -0.9472070932388306, 0,
                -0.038130562752485275, -0.0020653479732573032, 0.02310742810368538, 1,
            ],
            radius: 0.007231088820844889,
        },
        'ring-finger-tip': {
            offsetMatrix: [
                0.9995742440223694, 0.01638498157262802, 0.02412819117307663, 0,
                0.007813597097992897, -0.9474818110466003, 0.31971633434295654, 0,
                0.028100071474909782, -0.31939181685447693, -0.9472070932388306, 0,
                -0.0390593595802784, 0.004176302347332239, 0.0466572530567646, 1,
            ],
            radius: 0.0062310886569321156,
        },
        'pinky-finger-metacarpal': {
            offsetMatrix: [
                0.9147363901138306, 0.3458845317363739, 0.20885537564754486, 0,
                -0.3923271894454956, 0.8839452862739563, 0.2544005811214447, 0,
                -0.09662359952926636, -0.3146490156650543, 0.9442773461341858, 0,
                -0.06715242564678192, 0.024195827543735504, 0.07137546688318253, 1,
            ],
            radius: 0.01808827556669712,
        },
        'pinky-finger-phalanx-proximal': {
            offsetMatrix: [
                0.9613109827041626, 0.22439135611057281, 0.15977802872657776, 0,
                0.01002211682498455, 0.5511574745178223, -0.8343409299850464, 0,
                -0.27528178691864014, 0.8036624789237976, 0.5275853276252747, 0,
                -0.06273911893367767, 0.038559623062610626, 0.028268879279494286, 1,
            ],
            radius: 0.008483353070914745,
        },
        'pinky-finger-phalanx-intermediate': {
            offsetMatrix: [
                0.9820972084999084, 0.18811029195785522, -0.00995189044624567, 0,
                0.14063723385334015, -0.7673450708389282, -0.6256227493286133, 0,
                -0.12532226741313934, 0.6130226850509644, -0.7800630927085876, 0,
                -0.05428232625126839, 0.013870777562260628, 0.012061242014169693, 1,
            ],
            radius: 0.0067641944624483585,
        },
        'pinky-finger-phalanx-distal': {
            offsetMatrix: [
                0.9744614362716675, 0.20454788208007812, -0.09265263378620148, 0,
                0.22429193556308746, -0.9065253138542175, 0.35764020681381226, 0,
                -0.010836843401193619, -0.3692878782749176, -0.9292529225349426, 0,
                -0.05173685774207115, 0.0014194445684552193, 0.02790539152920246, 1,
            ],
            radius: 0.0064259846694767475,
        },
        'pinky-finger-tip': {
            offsetMatrix: [
                0.9744614362716675, 0.20454788208007812, -0.09265263378620148, 0,
                0.22429193556308746, -0.9065253138542175, 0.35764020681381226, 0,
                -0.010836843401193619, -0.3692878782749176, -0.9292529225349426, 0,
                -0.05098633095622063, 0.008463085629045963, 0.048688892275094986, 1,
            ],
            radius: 0.005425984505563974,
        },
    },
    gripOffsetMatrix: [
        0.005510995630174875, -0.9149997234344482, -0.40341615676879883, 0,
        -0.3571262061595917, -0.37861889600753784, 0.8538784384727478, 0,
        -0.9340395331382751, 0.13936474919319153, -0.32885703444480896, 0,
        -0.031803809106349945, 0.007837686687707901, 0.04313928261399269, 1,
    ],
};

/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
const relaxedHandPose = {
    jointTransforms: {
        wrist: {
            offsetMatrix: [
                0.9616971015930176, -0.13805118203163147, 0.2368120402097702, 0,
                0.0005348679260350764, 0.8648636937141418, 0.5020061135292053, 0,
                -0.2741127610206604, -0.48265108466148376, 0.8318111300468445, 0,
                -0.04913589730858803, 0.0021463718730956316, 0.11701996624469757, 1,
            ],
            radius: 0.021460847929120064,
        },
        'thumb-metacarpal': {
            offsetMatrix: [
                -0.07536252588033676, -0.9959676265716553, -0.04867160692811012, 0,
                0.5877083539962769, -0.08379616588354111, 0.8047218918800354, 0,
                -0.8055551648139954, 0.032041035592556, 0.5916536450386047, 0,
                -0.010643752291798592, 0.0006936835707165301, 0.08736639469861984, 1,
            ],
            radius: 0.019382517784833908,
        },
        'thumb-phalanx-proximal': {
            offsetMatrix: [
                0.1374533325433731, -0.9904957413673401, 0.004982374142855406, 0,
                0.5534393787384033, 0.08097179979085922, 0.8289443850517273, 0,
                -0.8214688897132874, -0.11118389666080475, 0.559309184551239, 0,
                0.015547193586826324, -3480653394944966e-19, 0.0681300163269043, 1,
            ],
            radius: 0.01228295173496008,
        },
        'thumb-phalanx-distal': {
            offsetMatrix: [
                -0.04659227654337883, -0.9974699020385742, -0.05369402840733528, 0,
                0.6812446117401123, -0.07104194164276123, 0.728600800037384, 0,
                -0.7305715084075928, -0.002631746232509613, 0.6828309893608093, 0,
                0.04330715537071228, 0.003409178927540779, 0.0492292083799839, 1,
            ],
            radius: 0.009768804535269737,
        },
        'thumb-tip': {
            offsetMatrix: [
                -0.04659227654337883, -0.9974699020385742, -0.05369402840733528, 0,
                0.6812446117401123, -0.07104194164276123, 0.728600800037384, 0,
                -0.7305715084075928, -0.002631746232509613, 0.6828309893608093, 0,
                0.062003348022699356, 0.004069602582603693, 0.03322213143110275, 1,
            ],
            radius: 0.008768804371356964,
        },
        'index-finger-metacarpal': {
            offsetMatrix: [
                0.9616971015930176, -0.13805118203163147, 0.2368120402097702, 0,
                0.0005348679260350764, 0.8648636937141418, 0.5020061135292053, 0,
                -0.2741127610206604, -0.48265108466148376, 0.8318111300468445, 0,
                -0.02009812369942665, 0.008770795539021492, 0.08660387247800827, 1,
            ],
            radius: 0.021228281781077385,
        },
        'index-finger-phalanx-proximal': {
            offsetMatrix: [
                0.9001791477203369, -0.2598813474178314, 0.3494834005832672, 0,
                0.06073702871799469, 0.8695210218429565, 0.490146666765213, 0,
                -0.4312632381916046, -0.41999316215515137, 0.7985095381736755, 0,
                -17739279428496957e-20, 0.03890012577176094, 0.039073407649993896, 1,
            ],
            radius: 0.010295259766280651,
        },
        'index-finger-phalanx-intermediate': {
            offsetMatrix: [
                0.9082008600234985, -0.20898112654685974, 0.36262574791908264, 0,
                0.11045389622449875, 0.9553793668746948, 0.27395179867744446, 0,
                -0.40369608998298645, -0.20874978601932526, 0.8907597661018372, 0,
                0.01617925800383091, 0.05482936650514603, 0.008788082748651505, 1,
            ],
            radius: 0.00853810179978609,
        },
        'index-finger-phalanx-distal': {
            offsetMatrix: [
                0.9309692978858948, -0.16783711314201355, 0.32423174381256104, 0,
                0.1080828532576561, 0.9749603867530823, 0.1943446695804596, 0,
                -0.34873148798942566, -0.14588497579097748, 0.9257990717887878, 0,
                0.02599053829908371, 0.059902746230363846, -0.012860597111284733, 1,
            ],
            radius: 0.007636196445673704,
        },
        'index-finger-tip': {
            offsetMatrix: [
                0.9309692978858948, -0.16783711314201355, 0.32423174381256104, 0,
                0.1080828532576561, 0.9749603867530823, 0.1943446695804596, 0,
                -0.34873148798942566, -0.14588497579097748, 0.9257990717887878, 0,
                0.03362493962049484, 0.06421422213315964, -0.033461250364780426, 1,
            ],
            radius: 0.006636196281760931,
        },
        'middle-finger-metacarpal': {
            offsetMatrix: [
                0.9616971015930176, -0.13805118203163147, 0.2368120402097702, 0,
                0.0005348679260350764, 0.8648636937141418, 0.5020061135292053, 0,
                -0.2741127610206604, -0.48265108466148376, 0.8318111300468445, 0,
                -0.03627845644950867, 0.011579737067222595, 0.08550142496824265, 1,
            ],
            radius: 0.021231964230537415,
        },
        'middle-finger-phalanx-proximal': {
            offsetMatrix: [
                0.9876697659492493, -0.06786545366048813, 0.1410750150680542, 0,
                -0.015095947310328484, 0.855663537979126, 0.5173118710517883, 0,
                -0.15582047402858734, -0.5130629539489746, 0.8440889716148376, 0,
                -0.021259509027004242, 0.04587256908416748, 0.03659208118915558, 1,
            ],
            radius: 0.01117393933236599,
        },
        'middle-finger-phalanx-intermediate': {
            offsetMatrix: [
                0.988391637802124, -0.04354291781783104, 0.14555205404758453, 0,
                0.008894841186702251, 0.9729899168014526, 0.23067504167556763, 0,
                -0.15166506171226501, -0.22670257091522217, 0.9620829224586487, 0,
                -0.014570588245987892, 0.06789684295654297, 0.0003578895702958107, 1,
            ],
            radius: 0.008030958473682404,
        },
        'middle-finger-phalanx-distal': {
            offsetMatrix: [
                0.9853697419166565, 0.044260796159505844, 0.16458062827587128, 0,
                -0.0757969319820404, 0.9787378311157227, 0.19059516489505768, 0,
                -0.1526455283164978, -0.20028135180473328, 0.9677740931510925, 0,
                -0.010392282158136368, 0.07414241135120392, -0.026147106662392616, 1,
            ],
            radius: 0.007629410829395056,
        },
        'middle-finger-tip': {
            offsetMatrix: [
                0.9853697419166565, 0.044260796159505844, 0.16458062827587128, 0,
                -0.0757969319820404, 0.9787378311157227, 0.19059516489505768, 0,
                -0.1526455283164978, -0.20028135180473328, 0.9677740931510925, 0,
                -0.0069718430750072, 0.08024183660745621, -0.05014154314994812, 1,
            ],
            radius: 0.006629410665482283,
        },
        'ring-finger-metacarpal': {
            offsetMatrix: [
                0.9616971015930176, -0.13805118203163147, 0.2368120402097702, 0,
                0.0005348679260350764, 0.8648636937141418, 0.5020061135292053, 0,
                -0.2741127610206604, -0.48265108466148376, 0.8318111300468445, 0,
                -0.05402477830648422, 0.015797706320881844, 0.08152295649051666, 1,
            ],
            radius: 0.019088275730609894,
        },
        'ring-finger-phalanx-proximal': {
            offsetMatrix: [
                0.9940828680992126, 0.05735103040933609, 0.09224652498960495, 0,
                -0.10022822767496109, 0.8116500377655029, 0.5754809379577637, 0,
                -0.041867565363645554, -0.5813214182853699, 0.8125960826873779, 0,
                -0.041623555123806, 0.04171867296099663, 0.03582974523305893, 1,
            ],
            radius: 0.00992213748395443,
        },
        'ring-finger-phalanx-intermediate': {
            offsetMatrix: [
                0.9843675494194031, 0.12044742703437805, 0.12850022315979004, 0,
                -0.15629759430885315, 0.9337108135223389, 0.3221098482608795, 0,
                -0.08118485659360886, -0.3371586799621582, 0.937940776348114, 0,
                -0.039990875869989395, 0.06438793987035751, 0.004141641780734062, 1,
            ],
            radius: 0.007611672393977642,
        },
        'ring-finger-phalanx-distal': {
            offsetMatrix: [
                0.9748351573944092, 0.11857274919748306, 0.18877571821212769, 0,
                -0.15575434267520905, 0.9681083559989929, 0.19623035192489624, 0,
                -0.15948788821697235, -0.22069483995437622, 0.9622148275375366, 0,
                -0.03783353418111801, 0.07334739714860916, -0.020782606676220894, 1,
            ],
            radius: 0.007231088820844889,
        },
        'ring-finger-tip': {
            offsetMatrix: [
                0.9748351573944092, 0.11857274919748306, 0.18877571821212769, 0,
                -0.15575434267520905, 0.9681083559989929, 0.19623035192489624, 0,
                -0.15948788821697235, -0.22069483995437622, 0.9622148275375366, 0,
                -0.03445569798350334, 0.0802423357963562, -0.04392268508672714, 1,
            ],
            radius: 0.0062310886569321156,
        },
        'pinky-finger-metacarpal': {
            offsetMatrix: [
                0.9181402921676636, 0.35625091195106506, 0.17350243031978607, 0,
                -0.39615097641944885, 0.8352503180503845, 0.38134080171585083, 0,
                -0.009065053425729275, -0.41885748505592346, 0.9080066680908203, 0,
                -0.06191859766840935, 0.013620133511722088, 0.07850203663110733, 1,
            ],
            radius: 0.01808827556669712,
        },
        'pinky-finger-phalanx-proximal': {
            offsetMatrix: [
                0.9714386463165283, 0.236698180437088, -0.016745081171393394, 0,
                -0.18462024629116058, 0.7982627749443054, 0.5733163952827454, 0,
                0.14906984567642212, -0.5538501739501953, 0.8191629648208618, 0,
                -0.061502378433942795, 0.032741155475378036, 0.03705105185508728, 1,
            ],
            radius: 0.008483353070914745,
        },
        'pinky-finger-phalanx-intermediate': {
            offsetMatrix: [
                0.9337416291236877, 0.35620439052581787, -0.03527557849884033, 0,
                -0.33203884959220886, 0.8987522721290588, 0.28634607791900635, 0,
                0.13370157778263092, -0.2556603252887726, 0.9574766755104065, 0,
                -0.06608185172080994, 0.049755651503801346, 0.011886020191013813, 1,
            ],
            radius: 0.0067641944624483585,
        },
        'pinky-finger-phalanx-distal': {
            offsetMatrix: [
                0.9419984817504883, 0.3303581774234772, 0.059175245463848114, 0,
                -0.33483216166496277, 0.9130291938781738, 0.23294763267040253, 0,
                0.02292730286717415, -0.2392500638961792, 0.970687210559845, 0,
                -0.0687975287437439, 0.054948460310697556, -0.007561664097011089, 1,
            ],
            radius: 0.0064259846694767475,
        },
        'pinky-finger-tip': {
            offsetMatrix: [
                0.9419984817504883, 0.3303581774234772, 0.059175245463848114, 0,
                -0.33483216166496277, 0.9130291938781738, 0.23294763267040253, 0,
                0.02292730286717415, -0.2392500638961792, 0.970687210559845, 0,
                -0.06947512179613113, 0.0613851435482502, -0.028543535619974136, 1,
            ],
            radius: 0.005425984505563974,
        },
    },
    gripOffsetMatrix: [
        -5348679260350764e-19, -0.8648636937141418, -0.5020061135292053, 0,
        -0.2741127908229828, -0.48265108466148376, 0.8318111896514893, 0,
        -0.9616971015930176, 0.13805119693279266, -0.2368120402097702, 0,
        -0.02878567762672901, 0.0017147823236882687, 0.04536811262369156, 1,
    ],
};

/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
const oculusHandConfig = {
    profileId: 'oculus-hand',
    fallbackProfileIds: [
        'generic-hand',
        'generic-hand-select',
        'generic-trigger',
    ],
    poses: {
        default: relaxedHandPose,
        pinch: pinchHandPose,
        point: pointHandPose,
    },
};
const XRHandGamepadConfig = {
    mapping: GamepadMappingType.None,
    buttons: [{ id: 'pinch', type: 'analog', eventTrigger: 'select' }],
    axes: [],
};
const fromPosition = create$4();
const fromQuaternion = create$2();
const fromScale = create$4();
const toPosition = create$4();
const toQuaternion = create$2();
const toScale = create$4();
const interpolatedPosition = create$4();
const interpolatedQuaternion = create$2();
const interpolatedScale = create$4();
const interpolateMatrix = (out, fromMatrix, toMatrix, alpha) => {
    getTranslation(fromPosition, fromMatrix);
    getRotation(fromQuaternion, fromMatrix);
    getScaling(fromScale, fromMatrix);
    getTranslation(toPosition, toMatrix);
    getRotation(toQuaternion, toMatrix);
    getScaling(toScale, toMatrix);
    lerp$1(interpolatedPosition, fromPosition, toPosition, alpha);
    slerp(interpolatedQuaternion, fromQuaternion, toQuaternion, alpha);
    lerp$1(interpolatedScale, fromScale, toScale, alpha);
    fromRotationTranslationScale(out, interpolatedQuaternion, interpolatedPosition, interpolatedScale);
    return out;
};
const mirrorMultiplierMatrix = [
    1, -1, -1, 0, -1, 1, 1, 0, -1, 1, 1, 0, -1, 1, 1, 1,
];
const mirrorMatrixToRight = (matrixLeft) => {
    for (let i = 0; i < 16; i++) {
        matrixLeft[i] *= mirrorMultiplierMatrix[i];
    }
};
class XRHandInput extends XRTrackedInput {
    constructor(handInputConfig, handedness, globalSpace) {
        if (handedness !== XRHandedness.Left && handedness !== XRHandedness.Right) {
            throw new DOMException('handedness for XRHandInput must be either "left" or "right"', 'InvalidStateError');
        }
        if (!handInputConfig.poses.default || !handInputConfig.poses.pinch) {
            throw new DOMException('"default" and "pinch" hand pose configs are required', 'InvalidStateError');
        }
        const targetRaySpace = new XRSpace(globalSpace);
        const gripSpace = new XRSpace(targetRaySpace);
        const profiles = [
            handInputConfig.profileId,
            ...handInputConfig.fallbackProfileIds,
        ];
        const hand = new XRHand();
        Object.values(XRHandJoint).forEach((jointName) => {
            hand.set(jointName, new XRJointSpace(jointName, targetRaySpace));
        });
        const inputSource = new XRInputSource(handedness, XRTargetRayMode.TrackedPointer, profiles, targetRaySpace, new Gamepad(XRHandGamepadConfig), gripSpace, hand);
        super(inputSource);
        this[P_HAND_INPUT] = {
            poseId: 'default',
            poses: handInputConfig.poses,
        };
        this.updateHandPose();
    }
    get poseId() {
        return this[P_HAND_INPUT].poseId;
    }
    set poseId(poseId) {
        if (!this[P_HAND_INPUT].poses[poseId]) {
            console.warn(`Pose config ${poseId} not found`);
            return;
        }
        this[P_HAND_INPUT].poseId = poseId;
    }
    updateHandPose() {
        const targetPose = this[P_HAND_INPUT].poses[this[P_HAND_INPUT].poseId];
        const pinchPose = this[P_HAND_INPUT].poses.pinch;
        Object.values(XRHandJoint).forEach((jointName) => {
            const targetJointMatrix = targetPose.jointTransforms[jointName].offsetMatrix;
            const pinchJointMatrix = pinchPose.jointTransforms[jointName].offsetMatrix;
            const jointSpace = this.inputSource.hand.get(jointName);
            interpolateMatrix(jointSpace[P_SPACE].offsetMatrix, targetJointMatrix, pinchJointMatrix, this.pinchValue);
            if (this.inputSource.handedness === XRHandedness.Right) {
                mirrorMatrixToRight(jointSpace[P_SPACE].offsetMatrix);
            }
            jointSpace[P_JOINT_SPACE].radius =
                (1 - this.pinchValue) * targetPose.jointTransforms[jointName].radius +
                    this.pinchValue * pinchPose.jointTransforms[jointName].radius;
        });
        if (targetPose.gripOffsetMatrix && pinchPose.gripOffsetMatrix) {
            interpolateMatrix(this.inputSource.gripSpace[P_SPACE].offsetMatrix, targetPose.gripOffsetMatrix, pinchPose.gripOffsetMatrix, this.pinchValue);
        }
    }
    get pinchValue() {
        return this[P_TRACKED_INPUT].inputSource.gamepad[P_GAMEPAD].buttonsMap['pinch'].value;
    }
    updatePinchValue(value) {
        if (value > 1 || value < 0) {
            console.warn(`Out-of-range value ${value} provided for pinch`);
            return;
        }
        const gamepadButton = this[P_TRACKED_INPUT].inputSource.gamepad[P_GAMEPAD].buttonsMap['pinch'];
        gamepadButton[P_GAMEPAD].pendingValue = value;
    }
    /** Clear or seed pinch state synchronously for interaction cancellation. */
    setPinchValueImmediate(value) {
        if (value > 1 || value < 0) {
            console.warn(`Out-of-range value ${value} provided for pinch`);
            return;
        }
        const gamepadButton = this[P_TRACKED_INPUT].inputSource.gamepad[P_GAMEPAD].buttonsMap.pinch;
        if (gamepadButton[P_GAMEPAD].immediateTransitionFrom === null) {
            gamepadButton[P_GAMEPAD].immediateTransitionFrom =
                gamepadButton[P_GAMEPAD].value;
        }
        gamepadButton[P_GAMEPAD].value = value;
        gamepadButton[P_GAMEPAD].pendingValue = value;
    }
    onFrameStart(frame) {
        super.onFrameStart(frame);
        this.updateHandPose();
    }
}

/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
class XRLayer extends EventTarget {
}
const defaultLayerInit = {
    antialias: true,
    depth: true,
    stencil: false,
    alpha: true,
    ignoreDepthValues: false,
    framebufferScaleFactor: 1.0,
};
class XRWebGLLayer extends XRLayer {
    constructor(session, context, layerInit = {}) {
        super();
        if (session[P_SESSION].ended) {
            throw new DOMException('Session has ended', 'InvalidStateError');
        }
        // TO-DO: Check that the context attribute has xrCompatible set to true
        // may require polyfilling the context and perhaps canvas.getContext
        // Default values for XRWebGLLayerInit, can be overridden by layerInit
        const config = { ...defaultLayerInit, ...layerInit };
        this[P_WEBGL_LAYER] = {
            session,
            context,
            antialias: config.antialias,
        };
    }
    get context() {
        return this[P_WEBGL_LAYER].context;
    }
    get antialias() {
        return this[P_WEBGL_LAYER].antialias;
    }
    get ignoreDepthValues() {
        return true;
    }
    get framebuffer() {
        return null;
    }
    get framebufferWidth() {
        return this[P_WEBGL_LAYER].context.drawingBufferWidth;
    }
    get framebufferHeight() {
        return this[P_WEBGL_LAYER].context.drawingBufferHeight;
    }
    getViewport(view) {
        if (view[P_VIEW].session !== this[P_WEBGL_LAYER].session) {
            throw new DOMException("View's session differs from Layer's session", 'InvalidStateError');
        }
        // TO-DO: check frame
        return this[P_WEBGL_LAYER].session[P_SESSION].device[P_DEVICE].getViewport(this, view);
    }
    static getNativeFramebufferScaleFactor(session) {
        if (!(session instanceof XRSession)) {
            throw new TypeError('getNativeFramebufferScaleFactor must be passed a session.');
        }
        if (session[P_SESSION].ended) {
            return 0.0;
        }
        // Return 1.0 for simplicity, actual implementation might vary based on the device capabilities
        return 1.0;
    }
}

/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
class ActionPlayer {
    constructor(refSpace, recording, ipd, options = {}) {
        var _a;
        const { schema, frames } = recording;
        if (!frames || !schema || frames.length === 0) {
            throw new DOMException('wrong recording format', 'NotSupportedError');
        }
        const viewerSpace = new XRReferenceSpace(XRReferenceSpaceType.Viewer, refSpace);
        const viewSpaces = {
            [XREye.Left]: new XRSpace(viewerSpace),
            [XREye.Right]: new XRSpace(viewerSpace),
            [XREye.None]: new XRSpace(viewerSpace),
        };
        this[P_ACTION_PLAYER] = {
            refSpace,
            inputSources: new Map(),
            inputSchemas: new Map(),
            frames,
            recordedFramePointer: 0,
            startingTimeStamp: frames[0][0],
            endingTimeStamp: frames[frames.length - 1][0],
            playbackTime: frames[0][0],
            playing: false,
            autoAdvance: true,
            manualFrameActive: false,
            viewerSpace,
            viewSpaces,
            vec3: create$4(),
            quat: create$2(),
            f1p: create$4(),
            f1q: create$2(),
            f2p: create$4(),
            f2q: create$2(),
            lastFrameInputs: new Map(),
            nextFrameInputs: new Map(),
            loop: (_a = options.loop) !== null && _a !== void 0 ? _a : false,
            playbackRate: options.playbackRate != null && options.playbackRate > 0
                ? options.playbackRate
                : 1,
            eventContext: options.eventContext,
            lastEventFramePointer: -1,
        };
        fromTranslation(this[P_ACTION_PLAYER].viewSpaces[XREye.Left][P_SPACE].offsetMatrix, fromValues$2(-ipd / 2, 0, 0));
        fromTranslation(this[P_ACTION_PLAYER].viewSpaces[XREye.Right][P_SPACE].offsetMatrix, fromValues$2(ipd / 2, 0, 0));
        schema.forEach((schemaEntry) => {
            const index = schemaEntry[0];
            const schema = schemaEntry[1];
            let gamepad;
            if (schema.hasGamepad) {
                const buttons = [];
                for (let i = 0; i < schema.numButtons; i++) {
                    buttons.push({ id: i.toString(), type: 'manual' });
                }
                const axes = [];
                for (let i = 0; i < schema.numAxes; i++) {
                    axes.push({ id: i.toString(), type: 'manual' });
                }
                gamepad = new Gamepad({
                    mapping: schema.mapping,
                    buttons,
                    axes,
                });
            }
            const targetRaySpace = new XRSpace(refSpace);
            let hand = undefined;
            if (schema.hasHand) {
                hand = new XRHand();
                Object.values(XRHandJoint).forEach((jointName) => {
                    hand.set(jointName, new XRJointSpace(jointName, targetRaySpace));
                });
            }
            const inputSource = new XRInputSource(schema.handedness, schema.targetRayMode, schema.profiles, targetRaySpace, gamepad, schema.hasGrip ? new XRSpace(refSpace) : undefined, schema.hasHand ? hand : undefined);
            this[P_ACTION_PLAYER].inputSources.set(index, {
                active: false,
                source: inputSource,
            });
            this[P_ACTION_PLAYER].inputSchemas.set(index, schema);
        });
        // Validate up front that every recorded frame's gamepad data matches the
        // expected button/axis counts, so a malformed recording fails loudly here
        // instead of crashing deep inside playback.
        frames.forEach((frame, frameIndex) => {
            for (let i = 8; i < frame.length; i++) {
                const inputDataRaw = frame[i];
                const index = inputDataRaw[0];
                const schema = this[P_ACTION_PLAYER].inputSchemas.get(index);
                if (!schema) {
                    throw new DOMException(`recording frame ${frameIndex} references unknown input source ${index}`, 'NotSupportedError');
                }
                if (schema.hasGamepad) {
                    let dataCounter = 8;
                    if (schema.hasGrip)
                        dataCounter++;
                    if (schema.hasHand)
                        dataCounter++;
                    const gamepadData = inputDataRaw[dataCounter];
                    const expectedLength = schema.numButtons + schema.numAxes;
                    if (!Array.isArray(gamepadData) ||
                        gamepadData.length !== expectedLength) {
                        const actualLength = Array.isArray(gamepadData)
                            ? gamepadData.length
                            : 'no';
                        throw new DOMException(`recording frame ${frameIndex} input source ${index} has ` +
                            `${actualLength} gamepad entries, expected ${expectedLength} ` +
                            `(${schema.numButtons} buttons + ${schema.numAxes} axes)`, 'NotSupportedError');
                    }
                }
            }
        });
    }
    play() {
        var _a, _b;
        (_b = (_a = this[P_ACTION_PLAYER].eventContext) === null || _a === void 0 ? void 0 : _a.onDiscontinuity) === null || _b === void 0 ? void 0 : _b.call(_a);
        this[P_ACTION_PLAYER].recordedFramePointer = 0;
        this[P_ACTION_PLAYER].playbackTime =
            this[P_ACTION_PLAYER].startingTimeStamp;
        this[P_ACTION_PLAYER].playing = true;
        this[P_ACTION_PLAYER].autoAdvance = true;
        this[P_ACTION_PLAYER].manualFrameActive = false;
        this[P_ACTION_PLAYER].actualTimeStamp = performance.now();
        // Reset edge-detection baseline so the first frame doesn't spuriously fire.
        this[P_ACTION_PLAYER].lastEventFramePointer = -1;
    }
    stop() {
        this[P_ACTION_PLAYER].playing = false;
        this[P_ACTION_PLAYER].autoAdvance = true;
        this[P_ACTION_PLAYER].manualFrameActive = false;
    }
    get playing() {
        return this[P_ACTION_PLAYER].playing;
    }
    get viewerSpace() {
        return this[P_ACTION_PLAYER].viewerSpace;
    }
    get viewSpaces() {
        return this[P_ACTION_PLAYER].viewSpaces;
    }
    get inputSources() {
        return Array.from(this[P_ACTION_PLAYER].inputSources.values())
            .filter((wrapper) => wrapper.active)
            .map((wrapper) => wrapper.source);
    }
    get loop() {
        return this[P_ACTION_PLAYER].loop;
    }
    set loop(value) {
        this[P_ACTION_PLAYER].loop = value;
    }
    get playbackRate() {
        return this[P_ACTION_PLAYER].playbackRate;
    }
    set playbackRate(value) {
        // Ignore non-positive rates so the wall-clock advance never stalls/reverses.
        if (value > 0) {
            this[P_ACTION_PLAYER].playbackRate = value;
        }
    }
    /**
     * Attach (or clear) the event context used to dispatch select/squeeze events
     * during playback. Passing undefined disables event dispatch.
     */
    setEventContext(context) {
        this[P_ACTION_PLAYER].eventContext = context;
    }
    /**
     * Total length of the recording in milliseconds (last frame timestamp minus
     * first). 0 for a single-frame recording.
     */
    get duration() {
        return (this[P_ACTION_PLAYER].endingTimeStamp -
            this[P_ACTION_PLAYER].startingTimeStamp);
    }
    /**
     * Current playback position in milliseconds, relative to the start of the
     * recording (0 at the first frame).
     */
    get currentTime() {
        return (this[P_ACTION_PLAYER].playbackTime -
            this[P_ACTION_PLAYER].startingTimeStamp);
    }
    /**
     * Jump playback to an absolute position, expressed in milliseconds relative to
     * the start of the recording. The time is clamped to [0, duration]. The frame
     * pointer is resolved with a binary search over the frames (sorted ascending
     * by timestamp at frame[0]), so backward seeks work correctly. Does not render
     * a frame on its own; the next playFrame()/stepFrames() call samples the new
     * position. The wall-clock anchor is reset so a subsequent playFrame() doesn't
     * fast-forward across the jump.
     */
    seek(timeMs) {
        var _a, _b;
        const state = this[P_ACTION_PLAYER];
        const clamped = Math.max(0, Math.min(timeMs, this.duration));
        const absolute = state.startingTimeStamp + clamped;
        const nextFramePointer = this.findFramePointer(absolute);
        if (nextFramePointer !== state.recordedFramePointer) {
            (_b = (_a = state.eventContext) === null || _a === void 0 ? void 0 : _a.onDiscontinuity) === null || _b === void 0 ? void 0 : _b.call(_a);
            // A frame-changing seek is a discontinuity: reset the edge baseline so
            // the jump itself doesn't manufacture select/squeeze edges.
            state.lastEventFramePointer = -1;
        }
        state.playbackTime = absolute;
        state.recordedFramePointer = nextFramePointer;
        // Re-anchor wall-clock playback so the next delta starts from this instant.
        state.actualTimeStamp = performance.now();
    }
    /**
     * Binary search for the index of the last frame whose timestamp is <= the
     * given absolute time. Returns 0 when the time precedes the first frame.
     */
    findFramePointer(absoluteTime) {
        const frames = this[P_ACTION_PLAYER].frames;
        let lo = 0;
        let hi = frames.length - 1;
        let result = 0;
        while (lo <= hi) {
            const mid = (lo + hi) >> 1;
            if (frames[mid][0] <= absoluteTime) {
                result = mid;
                lo = mid + 1;
            }
            else {
                hi = mid - 1;
            }
        }
        return result;
    }
    /**
     * Advance playback by exactly n recorded frames (default 1), deterministically
     * and independent of wall-clock time, for headless/agent driving. Each step
     * samples the recording at a frame boundary (alpha == 0, no interpolation) and
     * dispatches any select/squeeze edges between consecutive frames. When loop is
     * enabled, stepping past the final frame wraps to the start; otherwise it
     * clamps to the final frame and stops playback. Sets playing to true on entry
     * so the surrounding pose getters report this player's spaces.
     */
    stepFrames(n = 1) {
        var _a, _b;
        const state = this[P_ACTION_PLAYER];
        const frames = state.frames;
        state.playing = true;
        state.autoAdvance = false;
        state.manualFrameActive = true;
        for (let step = 0; step < n; step++) {
            if (state.recordedFramePointer + 1 >= frames.length) {
                if (state.loop) {
                    (_b = (_a = state.eventContext) === null || _a === void 0 ? void 0 : _a.onDiscontinuity) === null || _b === void 0 ? void 0 : _b.call(_a);
                    state.recordedFramePointer = 0;
                    state.playbackTime = state.startingTimeStamp;
                    // The wrap is a discontinuity; don't fire edges across it.
                    state.lastEventFramePointer = -1;
                }
                else {
                    state.playbackTime = state.endingTimeStamp;
                    this.applyFrameAtPointer(0);
                    // Publicly the player is stopped at the end, but native mode keeps
                    // presenting this explicitly selected frame until stop() or play().
                    state.playing = false;
                    return;
                }
            }
            else {
                state.recordedFramePointer++;
                state.playbackTime = frames[state.recordedFramePointer][0];
            }
            this.applyFrameAtPointer(0);
        }
        // Keep the wall-clock anchor fresh so a later switch back to play() doesn't
        // jump.
        state.actualTimeStamp = performance.now();
    }
    playFrame() {
        var _a, _b;
        const now = performance.now();
        const delta = (now - this[P_ACTION_PLAYER].actualTimeStamp) *
            this[P_ACTION_PLAYER].playbackRate;
        this[P_ACTION_PLAYER].actualTimeStamp = now;
        this[P_ACTION_PLAYER].playbackTime += delta;
        const frames = this[P_ACTION_PLAYER].frames;
        if (this[P_ACTION_PLAYER].playbackTime >
            this[P_ACTION_PLAYER].endingTimeStamp) {
            if (this[P_ACTION_PLAYER].loop) {
                (_b = (_a = this[P_ACTION_PLAYER].eventContext) === null || _a === void 0 ? void 0 : _a.onDiscontinuity) === null || _b === void 0 ? void 0 : _b.call(_a);
                // Wrap back to the start, preserving any overshoot past the end so the
                // loop stays smooth, then resolve the pointer for the wrapped time.
                const overshoot = this[P_ACTION_PLAYER].playbackTime -
                    this[P_ACTION_PLAYER].endingTimeStamp;
                const wrapped = this.duration > 0
                    ? this[P_ACTION_PLAYER].startingTimeStamp +
                        (overshoot % this.duration)
                    : this[P_ACTION_PLAYER].startingTimeStamp;
                this[P_ACTION_PLAYER].playbackTime = wrapped;
                this[P_ACTION_PLAYER].recordedFramePointer =
                    this.findFramePointer(wrapped);
                // The wrap is a discontinuity; don't manufacture edges across it.
                this[P_ACTION_PLAYER].lastEventFramePointer = -1;
            }
            else {
                // Clamp to the recording's end so the final frame's pose is rendered
                // once (and single-frame recordings render at all) before stopping.
                this[P_ACTION_PLAYER].playbackTime =
                    this[P_ACTION_PLAYER].endingTimeStamp;
                this.stop();
            }
        }
        // Guard the advance so we never read past the last frame.
        while (this[P_ACTION_PLAYER].recordedFramePointer + 1 < frames.length &&
            frames[this[P_ACTION_PLAYER].recordedFramePointer + 1][0] <
                this[P_ACTION_PLAYER].playbackTime) {
            this[P_ACTION_PLAYER].recordedFramePointer++;
        }
        const hasNextFrame = this[P_ACTION_PLAYER].recordedFramePointer + 1 < frames.length;
        const lastFrameData = frames[this[P_ACTION_PLAYER].recordedFramePointer];
        const nextFrameData = hasNextFrame
            ? frames[this[P_ACTION_PLAYER].recordedFramePointer + 1]
            : lastFrameData;
        const alpha = hasNextFrame
            ? (this[P_ACTION_PLAYER].playbackTime - lastFrameData[0]) /
                (nextFrameData[0] - lastFrameData[0])
            : 0;
        this.applyFrameAtPointer(alpha);
    }
    /**
     * Sample the recording at the current frame pointer, applying poses, hands,
     * gamepad state, and active flags, and dispatch any select/squeeze edges
     * crossed since the previous applied frame. `alpha` is the interpolation
     * factor toward the next frame (0 snaps exactly to the pointer's frame, as the
     * deterministic stepFrames path uses). When there is no next frame the pointer
     * frame is used for both ends.
     */
    applyFrameAtPointer(alpha) {
        const frames = this[P_ACTION_PLAYER].frames;
        // When there is no next frame (single-frame recording or pointer at the
        // end), snap to the last frame's pose instead of dereferencing frames[ptr+1].
        const hasNextFrame = this[P_ACTION_PLAYER].recordedFramePointer + 1 < frames.length;
        const lastFrameData = frames[this[P_ACTION_PLAYER].recordedFramePointer];
        const nextFrameData = hasNextFrame
            ? frames[this[P_ACTION_PLAYER].recordedFramePointer + 1]
            : lastFrameData;
        this.updateXRSpaceFromMergedFrames(this[P_ACTION_PLAYER].viewerSpace, lastFrameData.slice(1, 8), nextFrameData.slice(1, 8), alpha);
        const lastFrameInputs = this[P_ACTION_PLAYER].lastFrameInputs;
        lastFrameInputs.clear();
        for (let i = 8; i < lastFrameData.length; i++) {
            const { index, inputData } = this.processRawInputData(lastFrameData[i]);
            lastFrameInputs.set(index, inputData);
        }
        const nextFrameInputs = this[P_ACTION_PLAYER].nextFrameInputs;
        nextFrameInputs.clear();
        for (let i = 8; i < nextFrameData.length; i++) {
            const { index, inputData } = this.processRawInputData(nextFrameData[i]);
            nextFrameInputs.set(index, inputData);
        }
        this[P_ACTION_PLAYER].inputSources.forEach((sourceWrapper) => {
            sourceWrapper.active = false;
        });
        nextFrameInputs.forEach((inputData, index) => {
            this[P_ACTION_PLAYER].inputSources.get(index).active = true;
            const inputSource = this[P_ACTION_PLAYER].inputSources.get(index).source;
            const schema = this[P_ACTION_PLAYER].inputSchemas.get(index);
            this.updateInputSource(inputSource, schema, lastFrameInputs.has(index) ? lastFrameInputs.get(index) : inputData, inputData, alpha);
        });
        this.dispatchSelectSqueezeEdges();
    }
    /**
     * Detect rising/falling edges of select/squeeze-triggering buttons between the
     * previously applied frame and the one at the current pointer, then dispatch
     * the corresponding XRInputSourceEvents on the session — mirroring
     * XRTrackedInput.onFrameStart's edge logic (lastValue 0 -> >0 fires
     * <trigger>+<trigger>start; >0 -> 0 fires <trigger>end). All frame boundaries
     * skipped since the last applied frame are scanned so no edge is missed when
     * the pointer advances by more than one frame. No-ops unless an event context
     * is attached and yields a frame. The recording format does not persist
     * per-button eventTrigger, so the xr-standard convention is used: button 0 ->
     * 'select', button 1 -> 'squeeze'.
     */
    dispatchSelectSqueezeEdges() {
        const state = this[P_ACTION_PLAYER];
        const context = state.eventContext;
        const pointer = state.recordedFramePointer;
        // Without a context we still maintain the baseline so a later attach starts
        // clean, but emit nothing.
        if (!context) {
            state.lastEventFramePointer = pointer;
            return;
        }
        const baseline = state.lastEventFramePointer;
        if (baseline < 0 || baseline === pointer) {
            // First applied frame (or no advance): establish the baseline silently.
            state.lastEventFramePointer = pointer;
            return;
        }
        const frame = context.getFrame();
        if (!frame) {
            state.lastEventFramePointer = pointer;
            return;
        }
        const frames = state.frames;
        const step = pointer > baseline ? 1 : -1;
        // Walk every adjacent frame pair from the baseline to the current pointer so
        // multi-frame jumps still fire each edge in order.
        for (let from = baseline; from !== pointer; from += step) {
            const a = step > 0 ? from : from - 1;
            const b = a + 1;
            this.dispatchEdgesBetweenFrames(frames[a], frames[b], context, frame);
        }
        state.lastEventFramePointer = pointer;
    }
    /**
     * Compare the recorded button values of two adjacent frames and dispatch the
     * select/squeeze edges between them on the given session/frame.
     */
    dispatchEdgesBetweenFrames(fromFrame, toFrame, context, frame) {
        var _a;
        // Build a quick lookup of the "from" frame's processed inputs by index.
        const fromInputs = new Map();
        for (let i = 8; i < fromFrame.length; i++) {
            const { index, inputData } = this.processRawInputData(fromFrame[i]);
            fromInputs.set(index, inputData);
        }
        for (let i = 8; i < toFrame.length; i++) {
            const { index, inputData } = this.processRawInputData(toFrame[i]);
            const schema = this[P_ACTION_PLAYER].inputSchemas.get(index);
            if (!schema || !schema.hasGamepad || !inputData.buttons) {
                continue;
            }
            const fromData = fromInputs.get(index);
            // A source that wasn't present last frame has no baseline; skip edges.
            if (!fromData || !fromData.buttons) {
                continue;
            }
            const inputSource = (_a = this[P_ACTION_PLAYER].inputSources.get(index)) === null || _a === void 0 ? void 0 : _a.source;
            if (!inputSource) {
                continue;
            }
            inputData.buttons.forEach((states, buttonIndex) => {
                var _a, _b;
                const eventTrigger = this.eventTriggerForButton(schema, buttonIndex);
                if (eventTrigger == null) {
                    return;
                }
                const lastValue = (_b = (_a = fromData.buttons[buttonIndex]) === null || _a === void 0 ? void 0 : _a[2]) !== null && _b !== void 0 ? _b : 0;
                const nextValue = states[2];
                if (lastValue === 0 && nextValue > 0) {
                    context.session.dispatchEvent(new XRInputSourceEvent(eventTrigger, { frame, inputSource }));
                    context.session.dispatchEvent(new XRInputSourceEvent(eventTrigger + 'start', {
                        frame,
                        inputSource,
                    }));
                }
                else if (lastValue > 0 && nextValue === 0) {
                    context.session.dispatchEvent(new XRInputSourceEvent(eventTrigger + 'end', {
                        frame,
                        inputSource,
                    }));
                }
            });
        }
    }
    /**
     * Map a recorded button index to its event trigger using the xr-standard
     * mapping convention (button 0 -> 'select', button 1 -> 'squeeze'), matching
     * how IWER's controller/hand configs assign eventTrigger. Other buttons (and
     * non-xr-standard mappings) have no trigger.
     */
    eventTriggerForButton(schema, buttonIndex) {
        if (schema.mapping !== GamepadMappingType.XRStandard) {
            return null;
        }
        if (buttonIndex === 0) {
            return 'select';
        }
        if (buttonIndex === 1) {
            return 'squeeze';
        }
        return null;
    }
    updateInputSource(inputSource, schema, lastInputData, nextInputData, alpha) {
        this.updateXRSpaceFromMergedFrames(inputSource.targetRaySpace, lastInputData.targetRayTransform, nextInputData.targetRayTransform, alpha);
        if (schema.hasGrip) {
            this.updateXRSpaceFromMergedFrames(inputSource.gripSpace, lastInputData.gripTransform, nextInputData.gripTransform, alpha);
        }
        if (schema.hasHand) {
            for (let i = 0; i < 25; i++) {
                const lastTransformArray = lastInputData.handTransforms.slice(i * 8, i * 8 + 7);
                const nextTransformArray = nextInputData.handTransforms.slice(i * 8, i * 8 + 7);
                const lastRadius = lastInputData.handTransforms[i * 8 + 7];
                const nextRadius = nextInputData.handTransforms[i * 8 + 7];
                const jointSpace = inputSource.hand.get(schema.jointSequence[i]);
                this.updateXRSpaceFromMergedFrames(jointSpace, lastTransformArray, nextTransformArray, alpha);
                jointSpace[P_JOINT_SPACE].radius =
                    (nextRadius - lastRadius) * alpha + lastRadius;
            }
        }
        if (schema.hasGamepad) {
            const gamepad = inputSource.gamepad;
            nextInputData.buttons.forEach((states, index) => {
                const gamepadButton = gamepad.buttons[index];
                gamepadButton[P_GAMEPAD].pressed = states[0] === 1 ? true : false;
                gamepadButton[P_GAMEPAD].touched = states[1] === 1 ? true : false;
                const lastValue = lastInputData.buttons[index][2];
                const nextValue = states[2];
                gamepadButton[P_GAMEPAD].value =
                    (nextValue - lastValue) * alpha + lastValue;
            });
            nextInputData.axes.forEach((nextValue, index) => {
                const lastValue = lastInputData.axes[index];
                gamepad[P_GAMEPAD].axesMap[index.toString()].x =
                    (nextValue - lastValue) * alpha + lastValue;
            });
        }
    }
    updateXRSpaceFromMergedFrames(space, lastTransform, nextTransform, alpha) {
        const f1p = set$2(this[P_ACTION_PLAYER].f1p, lastTransform[0], lastTransform[1], lastTransform[2]);
        const f1q = set(this[P_ACTION_PLAYER].f1q, lastTransform[3], lastTransform[4], lastTransform[5], lastTransform[6]);
        const f2p = set$2(this[P_ACTION_PLAYER].f2p, nextTransform[0], nextTransform[1], nextTransform[2]);
        const f2q = set(this[P_ACTION_PLAYER].f2q, nextTransform[3], nextTransform[4], nextTransform[5], nextTransform[6]);
        lerp$1(this[P_ACTION_PLAYER].vec3, f1p, f2p, alpha);
        slerp(this[P_ACTION_PLAYER].quat, f1q, f2q, alpha);
        fromRotationTranslation(space[P_SPACE].offsetMatrix, this[P_ACTION_PLAYER].quat, this[P_ACTION_PLAYER].vec3);
    }
    processRawInputData(inputDataRaw) {
        const index = inputDataRaw[0];
        const schema = this[P_ACTION_PLAYER].inputSchemas.get(index);
        const targetRayTransform = inputDataRaw.slice(1, 8);
        const inputData = { targetRayTransform };
        let dataCounter = 8;
        if (schema.hasGrip) {
            inputData.gripTransform = inputDataRaw[dataCounter++];
        }
        if (schema.hasHand) {
            inputData.handTransforms = inputDataRaw[dataCounter++];
        }
        if (schema.hasGamepad) {
            const gamepadData = inputDataRaw[dataCounter];
            inputData.buttons = gamepadData.slice(0, schema.numButtons);
            inputData.axes = gamepadData.slice(schema.numButtons);
        }
        return { index, inputData };
    }
}

const VERSION = "2.5.0";

/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
class XRReferenceSpaceEvent extends Event {
    constructor(type, eventInitDict) {
        super(type, eventInitDict);
        if (!eventInitDict.referenceSpace) {
            throw new Error('XRReferenceSpaceEventInit.referenceSpace is required');
        }
        this.referenceSpace = eventInitDict.referenceSpace;
        this.transform = eventInitDict.transform;
    }
}

/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
const GAZE_TRACKING_FEATURES = [
    'gaze-tracking',
    'eye-tracking',
];
const isGazeTrackingFeature = (feature) => GAZE_TRACKING_FEATURES.includes(feature);
/**
 * Returns whether a feature list advertises either spelling of the gaze
 * capability. The two descriptors are compatibility aliases for one source.
 */
const supportsGazeTracking = (supportedFeatures) => supportedFeatures.some(isGazeTrackingFeature);
/**
 * A persistent, viewer-relative gaze source.
 *
 * Gaze intentionally has no gamepad and emits no select events. Applications
 * combine its target ray with select state from an independent hand or
 * controller source (the gaze-plus-pinch contract used by IWSDK).
 */
class XRGazeInput extends XRTrackedInput {
    constructor(viewerSpace) {
        const inputSource = new XRInputSource(XRHandedness.None, XRTargetRayMode.Gaze, ['eye-gaze'], new XRSpace(viewerSpace));
        super(inputSource);
        // Unlike controllers and hands, gaze is expressed in viewer-local space.
        // Its origin is always the viewer origin; only its local orientation moves.
        this.position.set(0, 0, 0);
    }
    updateTargetRaySpace() {
        // Re-pin the origin in case a consumer mutated the interoperable Vector3.
        this.position.set(0, 0, 0);
        super.updateTargetRaySpace();
    }
}

/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
class XRSystem extends EventTarget {
    constructor(device) {
        super();
        this[P_SYSTEM] = {
            device,
            grantSession: ({ resolve, reject, mode, options }) => {
                // Check for active sessions and other constraints here
                if (this[P_SYSTEM].activeSession) {
                    reject(new DOMException('An active XRSession already exists.', 'InvalidStateError'));
                    return;
                }
                // Handle required and optional features
                const { requiredFeatures = [], optionalFeatures = [] } = options;
                const { supportedFeatures } = this[P_SYSTEM].device;
                const isFeatureSupported = (feature) => isGazeTrackingFeature(feature)
                    ? supportsGazeTracking(supportedFeatures)
                    : supportedFeatures.includes(feature);
                // Check if all required features are supported
                const allRequiredSupported = requiredFeatures.every(isFeatureSupported);
                if (!allRequiredSupported) {
                    reject(new Error('One or more required features are not supported by the device.'));
                    return;
                }
                // Filter out unsupported optional features
                const supportedOptionalFeatures = optionalFeatures.filter(isFeatureSupported);
                // Combine required and supported optional features into enabled features
                const enabledFeatures = Array.from(new Set([
                    ...requiredFeatures,
                    ...supportedOptionalFeatures,
                    'viewer',
                    'local',
                ]));
                // Proceed with session creation
                const session = new XRSession(this[P_SYSTEM].device, mode, enabledFeatures, options.depthSensing);
                this[P_SYSTEM].activeSession = session;
                // Listen for session end to clear the active session
                session.addEventListener('end', () => {
                    this[P_SYSTEM].activeSession = undefined;
                }, { once: true });
                resolve(session);
            },
        };
        // Initialize device change monitoring here if applicable
    }
    isSessionSupported(mode) {
        return new Promise((resolve, _reject) => {
            if (mode === 'inline') {
                resolve(true);
            }
            else {
                // Check for spatial tracking permission if necessary
                resolve(this[P_SYSTEM].device.supportedSessionModes.includes(mode));
            }
        });
    }
    requestSession(mode, options = {}) {
        return new Promise((resolve, reject) => {
            this.isSessionSupported(mode)
                .then((isSupported) => {
                if (!isSupported) {
                    reject(new DOMException('The requested XRSession mode is not supported.', 'NotSupportedError'));
                    return;
                }
                const sessionGrantConfig = {
                    resolve,
                    reject,
                    mode,
                    options,
                };
                this[P_SYSTEM].grantSession(sessionGrantConfig);
            })
                .catch(reject);
        });
    }
    offerSession(mode, options = {}) {
        return new Promise((resolve, reject) => {
            this.isSessionSupported(mode)
                .then((isSupported) => {
                var _a;
                if (!isSupported) {
                    reject(new DOMException('The requested XRSession mode is not supported.', 'NotSupportedError'));
                    return;
                }
                // Reject any previously pending offer so its promise settles
                // instead of being silently orphaned by this newer offer.
                (_a = this[P_SYSTEM].offeredSessionConfig) === null || _a === void 0 ? void 0 : _a.reject(new Error('Offer superseded by a new offerSession call.'));
                this[P_SYSTEM].offeredSessionConfig = {
                    resolve,
                    reject,
                    mode,
                    options,
                };
            })
                .catch(reject);
        });
    }
}

/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
class XRViewport {
    constructor(x, y, width, height) {
        this[P_VIEWPORT] = { x, y, width, height };
    }
    get x() {
        return this[P_VIEWPORT].x;
    }
    get y() {
        return this[P_VIEWPORT].y;
    }
    get width() {
        return this[P_VIEWPORT].width;
    }
    get height() {
        return this[P_VIEWPORT].height;
    }
}

/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
/**
 * Convert angular target bounds into a rectangular opening in an IWER preview.
 *
 * The preview projection is symmetric and described by `previewFovY`. Target
 * bounds may be asymmetric, so the resulting opening need not be centered.
 */
function calculateVisibilityMaskBounds(fieldOfView, previewFovY, viewportWidth, viewportHeight) {
    if (!Number.isFinite(previewFovY) ||
        previewFovY <= 0 ||
        previewFovY >= Math.PI ||
        !Number.isFinite(viewportWidth) ||
        !Number.isFinite(viewportHeight) ||
        viewportWidth <= 0 ||
        viewportHeight <= 0) {
        return { x: 0, y: 0, width: 0, height: 0 };
    }
    const previewTanY = Math.tan(previewFovY / 2);
    const previewTanX = previewTanY * (viewportWidth / viewportHeight);
    const leftNdc = clamp(-Math.tan(fieldOfView.angleLeft) / previewTanX, -1, 1);
    const rightNdc = clamp(Math.tan(fieldOfView.angleRight) / previewTanX, -1, 1);
    const bottomNdc = clamp(-Math.tan(fieldOfView.angleDown) / previewTanY, -1, 1);
    const topNdc = clamp(Math.tan(fieldOfView.angleUp) / previewTanY, -1, 1);
    const x = ((leftNdc + 1) / 2) * viewportWidth;
    const right = ((rightNdc + 1) / 2) * viewportWidth;
    const y = ((1 - topNdc) / 2) * viewportHeight;
    const bottom = ((1 - bottomNdc) / 2) * viewportHeight;
    return {
        x,
        y,
        width: Math.max(0, right - x),
        height: Math.max(0, bottom - y),
    };
}

/**
 * @license
 * webxr-layers-polyfill
 * Version 1.1.0
 * Copyright (c) 2021 Facebook, Inc. and its affiliates.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 * 
 * http://www.apache.org/licenses/LICENSE-2.0
 * 
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
*/

/**
 * @license
 * gl-matrix 
 * Version 3.4.3
 * Copyright (c) 2015-2021, Brandon Jones, Colin MacKenzie IV.
 * 
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 * 
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 * 
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
*/ 

var XRTextureType;
(function (XRTextureType) {
    XRTextureType["texture"] = "texture";
    XRTextureType["texture-array"] = "texture-array";
})(XRTextureType || (XRTextureType = {}));
var XRLayerLayout;
(function (XRLayerLayout) {
    XRLayerLayout["default"] = "default";
    XRLayerLayout["mono"] = "mono";
    XRLayerLayout["stereo"] = "stereo";
    XRLayerLayout["stereo-left-right"] = "stereo-left-right";
    XRLayerLayout["stereo-top-bottom"] = "stereo-top-bottom";
})(XRLayerLayout || (XRLayerLayout = {}));

const isReferenceSpace = (arg) => {
    return arg && typeof arg.getOffsetReferenceSpace === 'function';
};

const getGlobal = () => {
    return typeof global !== 'undefined'
        ? global
        : typeof self !== 'undefined'
            ? self
            : typeof window !== 'undefined'
                ? window
                : {};
};

const getFormatsFromInternalFormat = (context, providedFormat) => {
    switch (providedFormat) {
        case context.RGBA8:
        case context.RGB5_A1:
        case context.RGBA4:
        case context.SRGB8_ALPHA8:
            return {
                internalFormat: providedFormat,
                textureFormat: context.RGBA,
                type: context.UNSIGNED_BYTE,
            };
        case context.RGBA8_SNORM:
            return {
                internalFormat: providedFormat,
                textureFormat: context.RGBA,
                type: context.BYTE,
            };
        case context.RGB10_A2:
            return {
                internalFormat: providedFormat,
                textureFormat: context.RGBA,
                type: context.UNSIGNED_INT_2_10_10_10_REV,
            };
        case context.RGBA16F:
            return {
                internalFormat: providedFormat,
                textureFormat: context.RGBA,
                type: context.HALF_FLOAT,
            };
        case context.RGBA32F:
            return {
                internalFormat: providedFormat,
                textureFormat: context.RGBA,
                type: context.FLOAT,
            };
        case context.RGBA8UI:
            return {
                internalFormat: providedFormat,
                textureFormat: context.RGBA_INTEGER,
                type: context.UNSIGNED_BYTE,
            };
        case context.RGBA8I:
            return {
                internalFormat: providedFormat,
                textureFormat: context.RGBA_INTEGER,
                type: context.BYTE,
            };
        case context.RGBA16UI:
            return {
                internalFormat: providedFormat,
                textureFormat: context.RGBA_INTEGER,
                type: context.UNSIGNED_SHORT,
            };
        case context.RGBA16I:
            return {
                internalFormat: providedFormat,
                textureFormat: context.RGBA_INTEGER,
                type: context.SHORT,
            };
        case context.RGBA32UI:
            return {
                internalFormat: providedFormat,
                textureFormat: context.RGBA_INTEGER,
                type: context.UNSIGNED_INT,
            };
        case context.RGBA32I:
            return {
                internalFormat: providedFormat,
                textureFormat: context.RGBA_INTEGER,
                type: context.INT,
            };
        case context.RGB10_A2UI:
            return {
                internalFormat: providedFormat,
                textureFormat: context.RGBA_INTEGER,
                type: context.UNSIGNED_INT_2_10_10_10_REV,
            };
        case context.RGB8:
        case context.RGB565:
        case context.SRGB8:
            return {
                internalFormat: providedFormat,
                textureFormat: context.RGB,
                type: context.UNSIGNED_BYTE,
            };
        case context.RGB8_SNORM:
            return {
                internalFormat: providedFormat,
                textureFormat: context.RGB,
                type: context.BYTE,
            };
        case context.RGB16F:
        case context.R11F_G11F_B10F:
        case context.RGB9_E5:
            return {
                internalFormat: providedFormat,
                textureFormat: context.RGB,
                type: context.HALF_FLOAT,
            };
        case context.RGB32F:
            return {
                internalFormat: providedFormat,
                textureFormat: context.RGB,
                type: context.FLOAT,
            };
        case context.RGB8UI:
            return {
                internalFormat: providedFormat,
                textureFormat: context.RGB_INTEGER,
                type: context.UNSIGNED_BYTE,
            };
        case context.RGB8I:
            return {
                internalFormat: providedFormat,
                textureFormat: context.RGB_INTEGER,
                type: context.BYTE,
            };
        case context.RGB16UI:
            return {
                internalFormat: providedFormat,
                textureFormat: context.RGB_INTEGER,
                type: context.UNSIGNED_SHORT,
            };
        case context.RGB16I:
            return {
                internalFormat: providedFormat,
                textureFormat: context.RGB_INTEGER,
                type: context.SHORT,
            };
        case context.RGB32UI:
            return {
                internalFormat: providedFormat,
                textureFormat: context.RGB_INTEGER,
                type: context.UNSIGNED_INT,
            };
        case context.RGB32I:
            return {
                internalFormat: providedFormat,
                textureFormat: context.RGB_INTEGER,
                type: context.INT,
            };
        case context.DEPTH_COMPONENT16:
            return {
                internalFormat: providedFormat,
                textureFormat: context.DEPTH_COMPONENT,
                type: context.UNSIGNED_SHORT,
            };
        case context.DEPTH_COMPONENT24:
            return {
                internalFormat: providedFormat,
                textureFormat: context.DEPTH_COMPONENT,
                type: context.UNSIGNED_INT,
            };
        case context.DEPTH_COMPONENT32F:
            return {
                internalFormat: providedFormat,
                textureFormat: context.DEPTH_COMPONENT,
                type: context.FLOAT,
            };
        case context.DEPTH24_STENCIL8:
            return {
                internalFormat: providedFormat,
                textureFormat: context.DEPTH_STENCIL,
                type: context.UNSIGNED_INT_24_8,
            };
        case context.DEPTH32F_STENCIL8:
            return {
                internalFormat: providedFormat,
                textureFormat: context.DEPTH_STENCIL,
                type: context.FLOAT_32_UNSIGNED_INT_24_8_REV,
            };
        case context.DEPTH_COMPONENT:
            return getFormatsFromInternalFormat(context, context.DEPTH_COMPONENT24);
        case context.DEPTH_STENCIL:
            return getFormatsFromInternalFormat(context, context.DEPTH24_STENCIL8);
        case context.RGBA:
        case context.RGB:
        case context.LUMINANCE_ALPHA:
        case context.LUMINANCE:
        case context.ALPHA:
            return {
                internalFormat: providedFormat,
                textureFormat: providedFormat,
                type: context.UNSIGNED_BYTE,
            };
        default:
            throw new Error('Attempted to create polyfill with unsupported format.');
    }
};

class XRCompositionLayerPolyfill {
    constructor() {
        this._hasRunDeferredInitialize = false;
        this._media = null;
    }
    initialize(session, context) {
        this.session = session;
        if (context) {
            this.context = context;
        }
        this.blendTextureSourceAlpha = true;
    }
    destroy() {
        this._colorTextures = [];
        this._depthStencilTextures = [];
    }
    addEventListener(type, listener, options) { }
    dispatchEvent(event) {
        return false;
    }
    removeEventListener(type, callback, options) { }
    getContext() {
        return this.context;
    }
    getTextureType() {
        throw new Error('Unimplemented');
    }
    get colorTextures() {
        return this._colorTextures;
    }
    get depthStencilTextures() {
        return this._depthStencilTextures;
    }
    get colorTexturesMeta() {
        return this._texturesMeta;
    }
    get media() {
        if (!this.isMediaLayer()) {
            console.warn('Attempted to retrieve media from a non-media layer');
        }
        return this._media;
    }
    determineLayoutAttribute(textureType, context, layout) {
        if (!(context instanceof WebGL2RenderingContext) &&
            textureType === XRTextureType['texture-array']) {
            throw new TypeError();
        }
        if (layout === XRLayerLayout.mono) {
            return layout;
        }
        if (layout === XRLayerLayout.default) {
            if (this.session.internalViews && this.session.internalViews.length === 1) {
                return XRLayerLayout['mono'];
            }
            if (textureType === XRTextureType['texture-array']) {
                return layout;
            }
        }
        if (layout === XRLayerLayout.default || layout === XRLayerLayout.stereo) {
            return XRLayerLayout['stereo-left-right'];
        }
        return layout;
    }
    isMediaLayer() {
        return this._media !== null;
    }
    _deferredInitialize() { }
    initializeIfNeeded() {
        if (!this._hasRunDeferredInitialize) {
            this._hasRunDeferredInitialize = true;
            this._deferredInitialize();
        }
    }
    _allocateColorTexturesInternal(textureType, init) {
        let session = this.session;
        let views = session.internalViews;
        if (!views || views.length === 0) {
            console.warn("We can't allocate color textures without views");
            return;
        }
        this.initializeIfNeeded();
        if (this.layout === XRLayerLayout.mono) {
            if (textureType === XRTextureType['texture-array']) {
                const newTexture = this._createNewColorTexture(init.viewPixelWidth, init.viewPixelHeight, textureType, init.colorFormat);
                this._texturesMeta = [newTexture];
                this._colorTextures = [newTexture.texture];
                return;
            }
            else {
                const newTexture = this._createNewColorTexture(init.viewPixelWidth, init.viewPixelHeight, textureType, init.colorFormat);
                this._texturesMeta = [newTexture];
                this._colorTextures = [newTexture.texture];
                return;
            }
        }
        else if (this.layout === XRLayerLayout.stereo) {
            if (textureType === XRTextureType['texture-array']) {
                const newTexture = this._createNewColorTexture(init.viewPixelWidth, init.viewPixelHeight, textureType, init.colorFormat, 2);
                this._texturesMeta = [newTexture];
                this._colorTextures = [newTexture.texture];
                return;
            }
            else {
                const texture1 = this._createNewColorTexture(init.viewPixelWidth, init.viewPixelHeight, textureType, init.colorFormat);
                const texture2 = this._createNewColorTexture(init.viewPixelWidth, init.viewPixelHeight, textureType, init.colorFormat);
                this._texturesMeta = [texture1, texture2];
                this._colorTextures = [texture1.texture, texture2.texture];
                return;
            }
        }
        else if (this.layout === XRLayerLayout['stereo-left-right']) {
            const newTexture = this._createNewColorTexture(init.viewPixelWidth * 2, init.viewPixelHeight, textureType, init.colorFormat);
            this._texturesMeta = [newTexture];
            this._colorTextures = [newTexture.texture];
            return;
        }
        else if (this.layout === XRLayerLayout['stereo-top-bottom']) {
            const newTexture = this._createNewColorTexture(init.viewPixelWidth, init.viewPixelHeight * 2, textureType, init.colorFormat);
            this._texturesMeta = [newTexture];
            this._colorTextures = [newTexture.texture];
            return;
        }
    }
    _allocateDepthStencilTexturesInternal(textureType, init) {
        if (!init.depthFormat) {
            this._depthStencilTextures = [];
            return;
        }
        if (this._getSupportedDepthFormats().indexOf(init.depthFormat) < 0) {
            throw new Error('Depth format provided is not supported in non-projection layers.');
        }
        if (init.mipLevels < 1) {
            throw new Error('Invalid miplevel. Miplevel needs to be >= 1');
        }
        if (this.layout === XRLayerLayout.mono) {
            if (textureType === XRTextureType['texture-array']) {
                const newTexture = this._createNewDepthStencilTexture(init.viewPixelWidth, init.viewPixelHeight, textureType, init.depthFormat);
                this._depthStencilTextures = [newTexture.texture];
                return;
            }
            else {
                const newTexture = this._createNewColorTexture(init.viewPixelWidth, init.viewPixelHeight, textureType, init.depthFormat);
                this._depthStencilTextures = [newTexture.texture];
                return;
            }
        }
        else if (this.layout === XRLayerLayout.stereo) {
            if (textureType === XRTextureType['texture-array']) {
                const newTexture = this._createNewDepthStencilTexture(init.viewPixelWidth, init.viewPixelHeight, textureType, init.depthFormat, 2);
                this._depthStencilTextures = [newTexture.texture];
                return;
            }
            else {
                const texture1 = this._createNewDepthStencilTexture(init.viewPixelWidth, init.viewPixelHeight, textureType, init.depthFormat);
                const texture2 = this._createNewDepthStencilTexture(init.viewPixelWidth, init.viewPixelHeight, textureType, init.depthFormat);
                this._depthStencilTextures = [texture1.texture, texture2.texture];
                return;
            }
        }
        else if (this.layout === XRLayerLayout['stereo-left-right']) {
            const newTexture = this._createNewDepthStencilTexture(init.viewPixelWidth * 2, init.viewPixelHeight, textureType, init.depthFormat);
            this._depthStencilTextures = [newTexture.texture];
            return;
        }
        else if (this.layout === XRLayerLayout['stereo-top-bottom']) {
            const newTexture = this._createNewDepthStencilTexture(init.viewPixelWidth, init.viewPixelHeight * 2, textureType, init.depthFormat);
            this._depthStencilTextures = [newTexture.texture];
            return;
        }
    }
    _createNewColorTexture(width, height, textureType, colorFormat, layers = 1) {
        return this._createGenericPolyfillTexture(textureType, width, height, colorFormat, 0, layers);
    }
    _createNewDepthStencilTexture(width, height, textureType, depthFormat, layers = 1) {
        return this._createGenericPolyfillTexture(textureType, width, height, depthFormat, 0, layers);
    }
    _createGenericPolyfillTexture(textureType, width, height, textureFormat, mipmapLevel = 0, numLayers = 1) {
        if (textureType === XRTextureType['texture-array'] && numLayers <= 1) {
            console.warn('creating a texture array with a single layer...');
        }
        if (textureType === XRTextureType['texture-array'] &&
            this.context instanceof WebGLRenderingContext) {
            throw new Error('WebGL 1 does not support texture array');
        }
        let texture = this.context.createTexture();
        let textureMeta = {
            width,
            height,
            layers: numLayers,
            type: textureType,
            textureFormat: textureFormat,
            texture,
        };
        let internalFormat = textureFormat;
        let texImageType = this.context.UNSIGNED_BYTE;
        if (this.context instanceof WebGL2RenderingContext) {
            const expectedFormats = getFormatsFromInternalFormat(this.context, textureFormat);
            internalFormat = expectedFormats.internalFormat;
            textureFormat = expectedFormats.textureFormat;
            texImageType = expectedFormats.type;
        }
        else {
            if (textureFormat === this.context.DEPTH_COMPONENT) {
                texImageType = this.context.UNSIGNED_INT;
            }
            if (textureFormat === this.context.DEPTH_STENCIL) {
                texImageType = this.context.UNSIGNED_INT_24_8_WEBGL;
            }
        }
        if (textureType === XRTextureType['texture-array'] &&
            this.context instanceof WebGL2RenderingContext) {
            console.warn('texture-array layers are supported...questionably in the polyfill at the moment. Use at your own risk.');
            const existingTextureBinding = this.context.getParameter(this.context.TEXTURE_BINDING_2D_ARRAY);
            this.context.bindTexture(this.context.TEXTURE_2D_ARRAY, texture);
            if (this._getSupportedDepthFormats().indexOf(textureFormat) >= 0) {
                this.context.texStorage3D(this.context.TEXTURE_2D_ARRAY, 1, internalFormat, width, height, numLayers);
            }
            else {
                this.context.texImage3D(this.context.TEXTURE_2D_ARRAY, 0, internalFormat, width, height, numLayers, 0, textureFormat, texImageType, null);
            }
            this.context.bindTexture(this.context.TEXTURE_2D_ARRAY, existingTextureBinding);
        }
        else {
            const existingTextureBinding = this.context.getParameter(this.context.TEXTURE_BINDING_2D);
            this.context.bindTexture(this.context.TEXTURE_2D, texture);
            this.context.texImage2D(this.context.TEXTURE_2D, 0, internalFormat, width, height, 0, textureFormat, texImageType, null);
            this.context.bindTexture(this.context.TEXTURE_2D, existingTextureBinding);
        }
        return textureMeta;
    }
    _getSupportedDepthFormats() {
        const supportedDepthFormats = [];
        if (this.context instanceof WebGLRenderingContext) {
            if (!this.context.getExtension('WEBGL_depth_texture')) {
                return supportedDepthFormats;
            }
        }
        supportedDepthFormats.push(this.context.DEPTH_COMPONENT, this.context.DEPTH_STENCIL);
        if (this.context instanceof WebGL2RenderingContext) {
            supportedDepthFormats.push(this.context.DEPTH_COMPONENT24, this.context.DEPTH24_STENCIL8);
        }
        return supportedDepthFormats;
    }
}

const defaultCylinderLayerInit = {
    colorFormat: 0x1908,
    mipLevels: 1,
    layout: XRLayerLayout.mono,
    isStatic: false,
    space: null,
    viewPixelHeight: 0,
    viewPixelWidth: 0,
    textureType: XRTextureType.texture,
    radius: 2.0,
    centralAngle: 0.78539,
    aspectRatio: 2.0,
};
const defaultMediaCylinderLayerInit = {
    layout: XRLayerLayout.mono,
    invertStereo: false,
    space: null,
    radius: 2.0,
    centralAngle: 0.78539,
};
class XRCylinderLayer extends XRCompositionLayerPolyfill {
    constructor(init, media) {
        super();
        this._media = media !== null && media !== void 0 ? media : null;
        if (this.isMediaLayer()) {
            this.init = Object.assign(Object.assign({}, defaultMediaCylinderLayerInit), init);
        }
        else {
            this.init = Object.assign(Object.assign({}, defaultCylinderLayerInit), init);
        }
        this.radius = this.init.radius;
        this.centralAngle = this.init.centralAngle;
        this.aspectRatio = this.init.aspectRatio;
        this.space = this.init.space;
        this.layout = this.init.layout;
        const _global = getGlobal();
        if (this.init.transform) {
            this.transform = new _global.XRRigidTransform(init.transform.position, init.transform.orientation);
        }
        else {
            this.transform = new _global.XRRigidTransform({
                x: 0,
                y: 0,
                z: 0,
                w: 1,
            });
        }
        if (!this.isMediaLayer()) {
            this.isStatic = init.isStatic;
        }
    }
    getTextureType() {
        if (this.isMediaLayer()) {
            return XRTextureType.texture;
        }
        return this.init.textureType;
    }
    _deferredInitialize() {
        let layout = this.determineLayoutAttribute(this.init.textureType, this.context, this.init.layout);
        this.layout = layout;
        this.needsRedraw = true;
    }
    get colorTextures() {
        if (this.isMediaLayer()) {
            throw new Error('Media layers do not have associated textures');
        }
        if (!this._colorTextures || !this._colorTextures.length) {
            this._allocateColorTexturesInternal(this.getTextureType(), this.init);
        }
        return this._colorTextures;
    }
    get depthStencilTextures() {
        if (this.isMediaLayer()) {
            throw new Error('Media layers do not have associated textures');
        }
        if (!this._depthStencilTextures || !this._depthStencilTextures.length) {
            this._allocateDepthStencilTexturesInternal(this.getTextureType(), this.init);
        }
        return this._depthStencilTextures;
    }
    get colorTexturesMeta() {
        if (this.isMediaLayer()) {
            throw new Error('Media layers do not have associated textures');
        }
        if (!this._colorTextures || !this._colorTextures.length) {
            this._allocateColorTexturesInternal(this.getTextureType(), this.init);
        }
        return this._texturesMeta;
    }
    get width() {
        const circumference = 2 * this.radius * Math.PI;
        const percentage = this.centralAngle / (2 * Math.PI);
        return circumference * percentage;
    }
    get height() {
        return this.width / this.aspectRatio;
    }
}

const defaultEquirectLayerInit = {
    colorFormat: 0x1908,
    mipLevels: 1,
    layout: XRLayerLayout.mono,
    isStatic: false,
    space: null,
    viewPixelHeight: 0,
    viewPixelWidth: 0,
    textureType: XRTextureType.texture,
    radius: 0,
    centralHorizontalAngle: 6.28318,
    upperVerticalAngle: 1.570795,
    lowerVerticalAngle: -1.570795,
};
const defaultMediaEquirectLayerInit = {
    space: null,
    layout: XRLayerLayout.mono,
    invertStereo: false,
    radius: 0,
    centralHorizontalAngle: 6.28318,
    upperVerticalAngle: 1.570795,
    lowerVerticalAngle: -1.570795,
};
class XREquirectLayer extends XRCompositionLayerPolyfill {
    constructor(init, media) {
        super();
        this._media = media !== null && media !== void 0 ? media : null;
        if (this.isMediaLayer()) {
            this.init = Object.assign(Object.assign({}, defaultMediaEquirectLayerInit), init);
        }
        else {
            this.init = Object.assign(Object.assign({}, defaultEquirectLayerInit), init);
        }
        if (!isReferenceSpace(this.init.space)) {
            throw new TypeError("Equirect layer's space needs to be an XRReferenceSpace");
        }
        this.radius = this.init.radius;
        this.centralHorizontalAngle = this.init.centralHorizontalAngle;
        this.upperVerticalAngle = this.init.upperVerticalAngle;
        this.lowerVerticalAngle = this.init.lowerVerticalAngle;
        this.space = this.init.space;
        this.layout = this.init.layout;
        const _global = getGlobal();
        if (init.transform) {
            this.transform = new _global.XRRigidTransform(init.transform.position, init.transform.orientation);
        }
        else {
            this.transform = new _global.XRRigidTransform({
                x: 0,
                y: 0,
                z: 0,
                w: 1,
            });
        }
        if (!this.isMediaLayer()) {
            this.isStatic = init.isStatic;
        }
    }
    getTextureType() {
        if (this.isMediaLayer()) {
            return XRTextureType.texture;
        }
        return this.init.textureType;
    }
    _deferredInitialize() {
        let layout = this.determineLayoutAttribute(this.init.textureType, this.context, this.init.layout);
        this.layout = layout;
        this.needsRedraw = true;
    }
    get colorTextures() {
        if (this.isMediaLayer()) {
            throw new Error('Media layers do not have associated textures');
        }
        if (!this._colorTextures || !this._colorTextures.length) {
            this._allocateColorTexturesInternal(this.getTextureType(), this.init);
        }
        return this._colorTextures;
    }
    get depthStencilTextures() {
        if (this.isMediaLayer()) {
            throw new Error('Media layers do not have associated textures');
        }
        if (!this._depthStencilTextures || !this._depthStencilTextures.length) {
            this._allocateDepthStencilTexturesInternal(this.getTextureType(), this.init);
        }
        return this._depthStencilTextures;
    }
    get colorTexturesMeta() {
        if (this.isMediaLayer()) {
            throw new Error('Media layers do not have associated textures');
        }
        if (!this._colorTextures || !this._colorTextures.length) {
            this._allocateColorTexturesInternal(this.getTextureType(), this.init);
        }
        return this._texturesMeta;
    }
}

const defaultQuadLayerInit = {
    colorFormat: 0x1908,
    mipLevels: 1,
    layout: XRLayerLayout.mono,
    isStatic: false,
    space: null,
    viewPixelHeight: 0,
    viewPixelWidth: 0,
    textureType: XRTextureType.texture,
    width: 1.0,
    height: 1.0,
};
const defaultMediaQuadLayerInit = {
    space: null,
    layout: XRLayerLayout.mono,
    invertStereo: false,
};
class XRQuadLayer extends XRCompositionLayerPolyfill {
    constructor(init, media) {
        super();
        this._media = media !== null && media !== void 0 ? media : null;
        if (this.isMediaLayer()) {
            this.init = Object.assign(Object.assign({}, defaultMediaQuadLayerInit), init);
        }
        else {
            this.init = Object.assign(Object.assign({}, defaultQuadLayerInit), init);
        }
        this.width = this.init.width;
        this.height = this.init.height;
        this.space = this.init.space;
        this.layout = this.init.layout;
        const _global = getGlobal();
        if (this.init.transform) {
            this.transform = new _global.XRRigidTransform(init.transform.position, init.transform.orientation);
        }
        else {
            this.transform = new _global.XRRigidTransform({
                x: 0,
                y: 0,
                z: 0,
                w: 1,
            });
        }
        if (!this.isMediaLayer()) {
            this.isStatic = init.isStatic;
        }
    }
    getTextureType() {
        if (this.isMediaLayer()) {
            return XRTextureType.texture;
        }
        return this.init.textureType;
    }
    _deferredInitialize() {
        let layout = this.determineLayoutAttribute(this.init.textureType, this.context, this.init.layout);
        this.layout = layout;
        this.needsRedraw = true;
    }
    get colorTextures() {
        if (this.isMediaLayer()) {
            throw new Error('Media layers do not have associated textures');
        }
        if (!this._colorTextures || !this._colorTextures.length) {
            this._allocateColorTexturesInternal(this.getTextureType(), this.init);
        }
        return this._colorTextures;
    }
    get depthStencilTextures() {
        if (this.isMediaLayer()) {
            throw new Error('Media layers do not have associated textures');
        }
        if (!this._depthStencilTextures || !this._depthStencilTextures.length) {
            this._allocateDepthStencilTexturesInternal(this.getTextureType(), this.init);
        }
        return this._depthStencilTextures;
    }
    get colorTexturesMeta() {
        if (this.isMediaLayer()) {
            throw new Error('Media layers do not have associated textures');
        }
        if (!this._colorTextures || !this._colorTextures.length) {
            this._allocateColorTexturesInternal(this.getTextureType(), this.init);
        }
        return this._texturesMeta;
    }
}

class XRMediaBindingPolyfill {
    constructor(session) {
        this.session = session;
        if (this.session.ended) {
            throw new Error('Session has ended');
        }
    }
    createQuadLayer(video, init) {
        if (this.session.ended) {
            throw new Error('Session has ended');
        }
        if (init.layout === XRLayerLayout.default) {
            throw new TypeError('Media Quad layer cannot be created with layout of default');
        }
        let aspectRatio = this.calculateAspectRatio(video, init.layout);
        if (init.width === undefined && init.height === undefined) {
            init.width = 1;
        }
        if (init.height === undefined) {
            init.height = init.width / aspectRatio;
        }
        if (init.width === undefined) {
            init.width = init.height / aspectRatio;
        }
        let layer = new XRQuadLayer(init, video);
        layer.needsRedraw = false;
        layer.initialize(this.session);
        return layer;
    }
    createCylinderLayer(video, init) {
        if (this.session.ended) {
            throw new Error('Session has ended');
        }
        if (init.layout === XRLayerLayout.default) {
            throw new TypeError('Media Cylinder layer cannot be created with layout of default');
        }
        let aspectRatio = this.calculateAspectRatio(video, init.layout);
        if (init.aspectRatio === undefined) {
            init.aspectRatio = aspectRatio;
        }
        let layer = new XRCylinderLayer(init, video);
        layer.needsRedraw = false;
        layer.initialize(this.session);
        return layer;
    }
    createEquirectLayer(video, init) {
        if (this.session.ended) {
            throw new Error('Session has ended');
        }
        if (init.layout === XRLayerLayout.default) {
            throw new TypeError('Media Equirect layer cannot be created with layout of default');
        }
        if (!isReferenceSpace(init.space)) {
            throw new Error("Media Equirect layer's space must be of type XRReferenceSpace");
        }
        let layer = new XREquirectLayer(init, video);
        layer.needsRedraw = false;
        layer.initialize(this.session);
        return layer;
    }
    calculateAspectRatio(video, layout) {
        let width = video.videoWidth;
        let height = video.videoHeight;
        if (layout === XRLayerLayout['stereo-left-right']) {
            width /= 2;
        }
        if (layout === XRLayerLayout['stereo-top-bottom']) {
            height /= 2;
        }
        return width / height;
    }
}

const defaultXRProjectionLayerInit = {
    textureType: XRTextureType.texture,
    colorFormat: 0x1908,
    depthFormat: 0x1902,
    scaleFactor: 1.0,
};
class XRProjectionLayer extends XRCompositionLayerPolyfill {
    constructor(init = defaultXRProjectionLayerInit) {
        super();
        this.init = Object.assign(Object.assign({}, defaultXRProjectionLayerInit), init);
    }
    initialize(session, context) {
        super.initialize(session, context);
        this.initializeIfNeeded();
        let baseLayer = session.getBaseLayer();
        this.textureWidth = baseLayer.framebufferWidth * this.init.scaleFactor;
        this.textureHeight = baseLayer.framebufferHeight * this.init.scaleFactor;
    }
    _allocateProjectionColorTextures() {
        let array = [];
        let polyFillArray = [];
        const createTextureArray = () => {
            array = [];
            for (let tex of polyFillArray) {
                array.push(tex.texture);
            }
        };
        let session = this.session;
        let views = session.internalViews;
        if (!views || views.length === 0) {
            console.warn("We can't allocate color textures without views");
            return;
        }
        let baseLayer = session.getBaseLayer();
        let numViews = views.length;
        let width = baseLayer.framebufferWidth * this.init.scaleFactor / views.length;
        let height = baseLayer.framebufferHeight * this.init.scaleFactor;
        if (this.layout === XRLayerLayout.mono || this.layout === XRLayerLayout.default) {
            if (this.init.textureType === XRTextureType['texture-array']) {
                let texture = this._createNewColorTexture(width, height, XRTextureType['texture-array'], this.init.colorFormat, numViews);
                polyFillArray = [texture];
            }
            else {
                for (let view of views) {
                    let texture = this._createNewColorTexture(width, height, XRTextureType.texture, this.init.colorFormat);
                    polyFillArray.push(texture);
                }
            }
            createTextureArray();
            this._colorTexturesMeta = polyFillArray;
            this._colorTextures = array;
            return;
        }
        if (this.layout === XRLayerLayout['stereo-left-right']) {
            let texture = this._createNewColorTexture(width * numViews, height, this.init.textureType, this.init.colorFormat);
            polyFillArray = [texture];
        }
        else if (this.layout === XRLayerLayout['stereo-top-bottom']) {
            let texture = this._createNewColorTexture(width, height * numViews, this.init.textureType, this.init.colorFormat);
            polyFillArray = [texture];
        }
        createTextureArray();
        this._colorTexturesMeta = polyFillArray;
        this._colorTextures = array;
        return;
    }
    _allocateProjectionDepthStencilTextures() {
        let session = this.session;
        let views = session.internalViews;
        if (!views || views.length === 0) {
            return;
        }
        if (this.init.depthFormat === 0) {
            this._depthStencilTextures = [];
            return;
        }
        if (this.context instanceof WebGLRenderingContext) {
            let depthExtension = this.context.getExtension('WEBGL_depth_texture');
            if (!depthExtension) {
                this._depthStencilTextures = [];
                return;
            }
        }
        let array = [];
        let polyFillArray = [];
        const createTextureArray = () => {
            array = [];
            for (let tex of polyFillArray) {
                array.push(tex.texture);
            }
        };
        this.initializeIfNeeded();
        let baseLayer = session.getBaseLayer();
        let numViews = views.length;
        let width = baseLayer.framebufferWidth * this.init.scaleFactor / views.length;
        let height = baseLayer.framebufferHeight * this.init.scaleFactor;
        if (this.layout === XRLayerLayout.mono || this.layout === XRLayerLayout.default) {
            if (this.init.textureType === XRTextureType['texture-array']) {
                let texture = this._createNewDepthStencilTexture(width, height, this.init.textureType, this.init.depthFormat, numViews);
                polyFillArray = [texture];
            }
            else {
                for (let view of views) {
                    let texture = this._createNewDepthStencilTexture(width, height, this.init.textureType, this.init.depthFormat);
                    polyFillArray.push(texture);
                }
            }
            createTextureArray();
            this._depthStencilTextures = array;
            return;
        }
        if (this.layout === XRLayerLayout['stereo-left-right']) {
            let texture = this._createNewDepthStencilTexture(width * numViews, height, this.init.textureType, this.init.depthFormat);
            polyFillArray = [texture];
        }
        else if (this.layout === XRLayerLayout['stereo-top-bottom']) {
            let texture = this._createNewDepthStencilTexture(width, height * numViews, this.init.textureType, this.init.depthFormat);
            polyFillArray = [texture];
        }
        createTextureArray();
        this._depthStencilTextures = array;
        return;
    }
    get colorTextures() {
        if (!this._colorTextures || !this._colorTextures.length) {
            this._allocateProjectionColorTextures();
        }
        return this._colorTextures;
    }
    get depthStencilTextures() {
        if (this._depthStencilTextures === undefined) {
            this._allocateProjectionDepthStencilTextures();
        }
        return this._depthStencilTextures || [];
    }
    get colorTexturesMeta() {
        if (!this._colorTextures || !this._colorTextures.length) {
            this._allocateProjectionColorTextures();
        }
        return this._colorTexturesMeta;
    }
    getTextureType() {
        return this.init.textureType;
    }
    _deferredInitialize() {
        this.isStatic = false;
        this.ignoreDepthValues = false;
        this.fixedFoveation = 0;
        let layout = this.determineLayoutAttribute(this.init.textureType, this.context, XRLayerLayout.default);
        this.layout = layout;
        this.needsRedraw = true;
        let maxScaleFactor = this.determineMaximumScaleFactor();
        let scaleFactor = Math.min(this.init.scaleFactor, maxScaleFactor);
        this.init.scaleFactor = scaleFactor;
    }
    determineMaximumScaleFactor() {
        let baseLayer = this.session.getBaseLayer(this.context);
        let largestWidth = baseLayer.framebufferWidth;
        let largestHeight = baseLayer.framebufferHeight;
        if (this.layout === XRLayerLayout['stereo-left-right']) {
            largestWidth *= 2;
        }
        if (this.layout === XRLayerLayout['stereo-top-bottom']) {
            largestHeight *= 2;
        }
        let largestViewDimension = Math.max(largestWidth, largestHeight);
        let largestTextureDimension = this.context.getParameter(this.context.MAX_TEXTURE_SIZE);
        return largestTextureDimension / largestViewDimension;
    }
}

const initializeViewport = (viewport, texture, layout, offset, numViews) => {
    let x = 0;
    let y = 0;
    let width = texture.width;
    let height = texture.height;
    if (layout === XRLayerLayout['stereo-left-right']) {
        x = (texture.width * offset) / numViews;
        width = texture.width / numViews;
    }
    else if (layout === XRLayerLayout['stereo-top-bottom']) {
        y = (texture.height * offset) / numViews;
        height = texture.height / numViews;
    }
    viewport.x = x;
    viewport.y = y;
    viewport.width = width;
    viewport.height = height;
};

const compileShader = (gl, shaderSource, shaderType) => {
    var shader = gl.createShader(shaderType);
    gl.shaderSource(shader, shaderSource);
    gl.compileShader(shader);
    var success = gl.getShaderParameter(shader, gl.COMPILE_STATUS);
    if (!success) {
        throw 'could not compile shader:' + gl.getShaderInfoLog(shader);
    }
    return shader;
};
const createProgram = (gl, vertexShader, fragmentShader) => {
    const program = gl.createProgram();
    const compiledVS = compileShader(gl, vertexShader, gl.VERTEX_SHADER);
    const compiledFS = compileShader(gl, fragmentShader, gl.FRAGMENT_SHADER);
    gl.attachShader(program, compiledVS);
    gl.attachShader(program, compiledFS);
    gl.deleteShader(compiledVS);
    gl.deleteShader(compiledFS);
    gl.linkProgram(program);
    var success = gl.getProgramParameter(program, gl.LINK_STATUS);
    if (!success) {
        throw 'program failed to link:' + gl.getProgramInfoLog(program);
    }
    return program;
};
const setRectangle = (gl, x, y, width, height) => {
    var x1 = x;
    var x2 = x + width;
    var y1 = y;
    var y2 = y + height;
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([x1, y1, x2, y1, x1, y2, x1, y2, x2, y1, x2, y2]), gl.DYNAMIC_DRAW);
};
const applyVAOExtension = (gl) => {
    if (gl instanceof WebGL2RenderingContext) {
        return gl;
    }
    const ext = gl.getExtension('OES_vertex_array_object');
    if (!ext) {
        throw new Error('Cannot use VAOs.');
    }
    return {
        VERTEX_ARRAY_BINDING: ext.VERTEX_ARRAY_BINDING_OES,
        bindVertexArray: ext.bindVertexArrayOES.bind(ext),
        createVertexArray: ext.createVertexArrayOES.bind(ext),
        deleteVertexArray: ext.deleteVertexArrayOES.bind(ext),
        isVertexArray: ext.isVertexArrayOES.bind(ext),
    };
};

const glsl = (x) => x;
const vertexShader = glsl `
attribute vec2 a_position;
attribute vec2 a_texCoord;

varying vec2 v_texCoord;

void main() {
   // convert the rectangle from pixels to 0.0 to 1.0
   vec2 zeroToOne = a_position;

   // convert from 0->1 to 0->2
   vec2 zeroToTwo = zeroToOne * 2.0;

   // convert from 0->2 to -1->+1 (clipspace)
   vec2 clipSpace = zeroToTwo - 1.0;

   gl_Position = vec4(clipSpace * vec2(1, 1), 0, 1);

   // pass the texCoord to the fragment shader
   // The GPU will interpolate this value between points.
   v_texCoord = a_texCoord;
}
`;
const fragmentShader = glsl `
precision mediump float;

// our texture
uniform sampler2D u_image;

// the texCoords passed in from the vertex shader.
varying vec2 v_texCoord;

void main() {
   	vec4 tex = texture2D(u_image, v_texCoord);
	gl_FragColor = vec4(tex.rgb, tex.a);
}
`;
class ProjectionRenderer {
    constructor(layer, context) {
        this.gl = context;
        this.layer = layer;
        this.program = createProgram(this.gl, vertexShader, fragmentShader);
        this.programInfo = {
            attribLocations: {
                a_position: this.gl.getAttribLocation(this.program, 'a_position'),
                a_texCoord: this.gl.getAttribLocation(this.program, 'a_texCoord'),
            },
        };
        this._createVAOs();
    }
    render(session) {
        let gl = this.gl;
        let baseLayer = session.getBaseLayer();
        gl.viewport(0, 0, baseLayer.framebufferWidth, baseLayer.framebufferHeight);
        const textureType = this.layer.getTextureType();
        const existingTextureBinding = gl.getParameter(gl.TEXTURE_BINDING_2D);
        const existingActiveTexture = gl.getParameter(gl.ACTIVE_TEXTURE);
        if (textureType === XRTextureType.texture) {
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, this.layer.colorTextures[0]);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        }
        else {
            throw new Error(`Created a texture projection renderer instead of a texture-array projection renderer for a texture-array layer.
This is probably an error with the polyfill itself; please file an issue on Github if you run into this.`);
        }
        for (let view of session.internalViews) {
            let viewport = baseLayer.getViewport(view);
            gl.viewport(viewport.x, viewport.y, viewport.width, viewport.height);
            if (this._shouldUseStereoTexturePoints()) {
                this._renderInternalStereo(view);
            }
            else {
                this._renderInternal();
            }
        }
        gl.activeTexture(existingActiveTexture);
        gl.bindTexture(gl.TEXTURE_2D, existingTextureBinding);
    }
    _renderInternal() {
        let gl = this.gl;
        const existingProgram = gl.getParameter(gl.CURRENT_PROGRAM);
        gl.useProgram(this.program);
        this.vaoGl.bindVertexArray(this.vao);
        var primitiveType = gl.TRIANGLES;
        var offset = 0;
        var count = 6;
        gl.drawArrays(primitiveType, offset, count);
        this.vaoGl.bindVertexArray(null);
        gl.useProgram(existingProgram);
    }
    _renderInternalStereo(view) {
        if (view.eye === 'none') {
            return this._renderInternal();
        }
        let gl = this.gl;
        this.vaoGl.bindVertexArray(this.vao);
        const existingProgram = gl.getParameter(gl.CURRENT_PROGRAM);
        gl.useProgram(this.program);
        this._setStereoTextureBuffer(view.eye === 'right' ? 1 : 0);
        var primitiveType = gl.TRIANGLES;
        var offset = 0;
        var count = 6;
        gl.drawArrays(primitiveType, offset, count);
        this.vaoGl.bindVertexArray(null);
        gl.useProgram(existingProgram);
    }
    _createVAOs() {
        this._createTextureUVs();
        let gl = this.gl;
        this.vaoGl = applyVAOExtension(gl);
        let positionBuffer = gl.createBuffer();
        this.vao = this.vaoGl.createVertexArray();
        this.vaoGl.bindVertexArray(this.vao);
        gl.enableVertexAttribArray(this.programInfo.attribLocations.a_position);
        gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
        setRectangle(gl, 0, 0, 1.0, 1.0);
        let size = 2;
        let type = gl.FLOAT;
        let normalize = false;
        let stride = 0;
        let offset = 0;
        gl.vertexAttribPointer(this.programInfo.attribLocations.a_position, size, type, normalize, stride, offset);
        this.texcoordBuffer = gl.createBuffer();
        gl.enableVertexAttribArray(this.programInfo.attribLocations.a_texCoord);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.texcoordBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, this.texturePoints, gl.DYNAMIC_DRAW);
        gl.vertexAttribPointer(this.programInfo.attribLocations.a_texCoord, size, type, normalize, stride, offset);
        this.vaoGl.bindVertexArray(null);
        gl.bindBuffer(gl.ARRAY_BUFFER, null);
    }
    _setStereoTextureBuffer(index) {
        let gl = this.gl;
        gl.enableVertexAttribArray(this.programInfo.attribLocations.a_texCoord);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.texcoordBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, this.stereoTexturePoints[index], gl.STATIC_DRAW);
        var size = 2;
        var type = gl.FLOAT;
        var normalize = false;
        var stride = 0;
        var offset = 0;
        gl.vertexAttribPointer(this.programInfo.attribLocations.a_texCoord, size, type, normalize, stride, offset);
        gl.bindBuffer(gl.ARRAY_BUFFER, null);
    }
    _createTextureUVs() {
        this.texturePoints = new Float32Array([
            0.0,
            0.0,
            1.0,
            0.0,
            0.0,
            1.0,
            0.0,
            1.0,
            1.0,
            0.0,
            1.0,
            1.0,
        ]);
        const viewport = {
            x: 0,
            y: 0,
            width: 1,
            height: 1,
        };
        if (this._shouldUseStereoTexturePoints()) {
            this.stereoTexturePoints = [];
            initializeViewport(viewport, this.layer.colorTexturesMeta[0], this.layer.layout, 0, 2);
            this.stereoTexturePoints[0] = this._offsetTextureUVsByRect(this.layer.colorTexturesMeta[0], this.texturePoints, viewport);
            initializeViewport(viewport, this.layer.colorTexturesMeta[0], this.layer.layout, 1, 2);
            this.stereoTexturePoints[1] = this._offsetTextureUVsByRect(this.layer.colorTexturesMeta[0], this.texturePoints, viewport);
        }
    }
    _offsetTextureUVsByRect(texture, inArray, textureRect) {
        textureRect = textureRect !== null && textureRect !== void 0 ? textureRect : {
            x: 0,
            y: 0,
            width: texture.width,
            height: texture.height,
        };
        const uX = textureRect.x / texture.width;
        const vY = textureRect.y / texture.height;
        const uW = textureRect.width / texture.width;
        const vH = textureRect.height / texture.height;
        const outArray = [];
        for (let i = 0; i < inArray.length; i += 2) {
            let u = inArray[i];
            let v = inArray[i + 1];
            let newU = u * uW + uX;
            let newV = v * vH + vY;
            outArray[i] = newU;
            outArray[i + 1] = newV;
        }
        return new Float32Array(outArray);
    }
    _shouldUseStereoTexturePoints() {
        return (this.layer.layout === XRLayerLayout['stereo-left-right'] ||
            this.layer.layout === XRLayerLayout['stereo-top-bottom']);
    }
}
const texArrayVertexShader = glsl `#version 300 es

in vec2 a_position;
in vec2 a_texCoord;

out vec2 v_texCoord;

void main() {
	// convert the rectangle from pixels to 0.0 to 1.0
	vec2 zeroToOne = a_position;

	// convert from 0->1 to 0->2
	vec2 zeroToTwo = zeroToOne * 2.0;

	// convert from 0->2 to -1->+1 (clipspace)
	vec2 clipSpace = zeroToTwo - 1.0;

	gl_Position = vec4(clipSpace * vec2(1, 1), 0, 1);

	// pass the texCoord to the fragment shader
	// The GPU will interpolate this value between points.
	v_texCoord = a_texCoord;
}
`;
const texArrayFragmentShader = glsl `#version 300 es
precision mediump float;
precision mediump int;
precision mediump sampler2DArray;

uniform sampler2DArray u_image;
uniform int u_layer;

in vec2 v_texCoord;

out vec4 fragColor;

void main() {
	vec4 tex = texture(u_image, vec3(v_texCoord.x, v_texCoord.y, u_layer));
 	fragColor = vec4(tex.rgb, tex.a);
}

`;
class ProjectionTextureArrayRenderer extends ProjectionRenderer {
    constructor(layer, context) {
        super(layer, context);
        this.program = createProgram(this.gl, texArrayVertexShader, texArrayFragmentShader);
        this._createVAOs();
        this.u_layerInfo = this.gl.getUniformLocation(this.program, 'u_layer');
    }
    render(session) {
        let gl = this.gl;
        let textureType = this.layer.getTextureType();
        if (textureType === XRTextureType.texture) {
            throw new Error('Using texture array projection renderer on a layer without texture array.');
        }
        let baseLayer = session.getBaseLayer();
        const existingTextureBinding = gl.getParameter(gl.TEXTURE_BINDING_2D_ARRAY);
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.layer.colorTextures[0]);
        gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        for (let view of session.internalViews) {
            let index = session.getViewIndex(view);
            let viewport = baseLayer.getViewport(view);
            gl.viewport(viewport.x, viewport.y, viewport.width, viewport.height);
            this._renderInternal(index);
        }
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, existingTextureBinding);
    }
    _renderInternal(layer = 0) {
        let gl = this.gl;
        const existingProgram = gl.getParameter(gl.CURRENT_PROGRAM);
        gl.useProgram(this.program);
        gl.bindVertexArray(this.vao);
        gl.uniform1i(this.u_layerInfo, layer);
        var primitiveType = gl.TRIANGLES;
        var offset = 0;
        var count = 6;
        gl.drawArrays(primitiveType, offset, count);
        gl.bindVertexArray(null);
        gl.useProgram(existingProgram);
    }
}
const createProjectionRenderer = (layer, context) => {
    if (layer.getTextureType() === XRTextureType['texture-array']) {
        if (context instanceof WebGL2RenderingContext) {
            return new ProjectionTextureArrayRenderer(layer, context);
        }
    }
    return new ProjectionRenderer(layer, context);
};

var ARRAY_TYPE = typeof Float32Array !== 'undefined' ? Float32Array : Array;
if (!Math.hypot) Math.hypot = function () {
  var y = 0,
      i = arguments.length;
  while (i--) {
    y += arguments[i] * arguments[i];
  }
  return Math.sqrt(y);
};

function create() {
  var out = new ARRAY_TYPE(16);
  if (ARRAY_TYPE != Float32Array) {
    out[1] = 0;
    out[2] = 0;
    out[3] = 0;
    out[4] = 0;
    out[6] = 0;
    out[7] = 0;
    out[8] = 0;
    out[9] = 0;
    out[11] = 0;
    out[12] = 0;
    out[13] = 0;
    out[14] = 0;
  }
  out[0] = 1;
  out[5] = 1;
  out[10] = 1;
  out[15] = 1;
  return out;
}
function multiply(out, a, b) {
  var a00 = a[0],
      a01 = a[1],
      a02 = a[2],
      a03 = a[3];
  var a10 = a[4],
      a11 = a[5],
      a12 = a[6],
      a13 = a[7];
  var a20 = a[8],
      a21 = a[9],
      a22 = a[10],
      a23 = a[11];
  var a30 = a[12],
      a31 = a[13],
      a32 = a[14],
      a33 = a[15];
  var b0 = b[0],
      b1 = b[1],
      b2 = b[2],
      b3 = b[3];
  out[0] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
  out[1] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
  out[2] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
  out[3] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
  b0 = b[4];
  b1 = b[5];
  b2 = b[6];
  b3 = b[7];
  out[4] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
  out[5] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
  out[6] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
  out[7] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
  b0 = b[8];
  b1 = b[9];
  b2 = b[10];
  b3 = b[11];
  out[8] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
  out[9] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
  out[10] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
  out[11] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
  b0 = b[12];
  b1 = b[13];
  b2 = b[14];
  b3 = b[15];
  out[12] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
  out[13] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
  out[14] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
  out[15] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
  return out;
}
function fromQuat(out, q) {
  var x = q[0],
      y = q[1],
      z = q[2],
      w = q[3];
  var x2 = x + x;
  var y2 = y + y;
  var z2 = z + z;
  var xx = x * x2;
  var yx = y * x2;
  var yy = y * y2;
  var zx = z * x2;
  var zy = z * y2;
  var zz = z * z2;
  var wx = w * x2;
  var wy = w * y2;
  var wz = w * z2;
  out[0] = 1 - yy - zz;
  out[1] = yx + wz;
  out[2] = zx - wy;
  out[3] = 0;
  out[4] = yx - wz;
  out[5] = 1 - xx - zz;
  out[6] = zy + wx;
  out[7] = 0;
  out[8] = zx + wy;
  out[9] = zy - wx;
  out[10] = 1 - xx - yy;
  out[11] = 0;
  out[12] = 0;
  out[13] = 0;
  out[14] = 0;
  out[15] = 1;
  return out;
}

function create$1() {
  var out = new ARRAY_TYPE(2);
  if (ARRAY_TYPE != Float32Array) {
    out[0] = 0;
    out[1] = 0;
  }
  return out;
}
(function () {
  var vec = create$1();
  return function (a, stride, offset, count, fn, arg) {
    var i, l;
    if (!stride) {
      stride = 2;
    }
    if (!offset) {
      offset = 0;
    }
    if (count) {
      l = Math.min(count * stride + offset, a.length);
    } else {
      l = a.length;
    }
    for (i = offset; i < l; i += stride) {
      vec[0] = a[i];
      vec[1] = a[i + 1];
      fn(vec, vec, arg);
      a[i] = vec[0];
      a[i + 1] = vec[1];
    }
    return a;
  };
})();

const glsl$1 = (x) => x;
const vertexShader$1 = glsl$1 `
attribute vec4 a_position;
attribute vec2 a_texCoord;

uniform mat4 u_matrix;
uniform mat4 u_projectionMatrix;

varying vec2 v_texCoord;

void main() {
  // Multiply the position by the matrix.
  gl_Position = u_projectionMatrix * u_matrix * a_position;

   // pass the texCoord to the fragment shader
   // The GPU will interpolate this value between points.
   v_texCoord = a_texCoord;
}
`;
const fragmentShader$1 = glsl$1 `
precision mediump float;

// our texture
uniform sampler2D u_image;

// the texCoords passed in from the vertex shader.
varying vec2 v_texCoord;

void main() {
   	vec4 tex = texture2D(u_image, v_texCoord);
	gl_FragColor = vec4(tex.rgb, tex.a);
	// gl_FragColor = vec4(1.0, 0, 0, 1.0);
}
`;
const texArrayVertexShader$1 = glsl$1 `#version 300 es

in vec4 a_position;
in vec2 a_texCoord;

uniform mat4 u_matrix;
uniform mat4 u_projectionMatrix;

out vec2 v_texCoord;

void main() {
	// Multiply the position by the matrix.
    gl_Position = u_projectionMatrix * u_matrix * a_position;

	// pass the texCoord to the fragment shader
	// The GPU will interpolate this value between points.
	v_texCoord = a_texCoord;
}
`;
const texArrayFragmentShader$1 = glsl$1 `#version 300 es
precision mediump float;
precision mediump int;
precision mediump sampler2DArray;

uniform sampler2DArray u_image;
uniform int u_layer;

in vec2 v_texCoord;

out vec4 fragColor;

void main() {
	vec4 tex = texture(u_image, vec3(v_texCoord.x, v_texCoord.y, u_layer));
 	fragColor = vec4(tex.rgb, tex.a);
}

`;
class CompositionLayerRenderer {
    constructor(layer, context) {
        this.usesTextureArrayShaders = false;
        this.savedVaoState = { vao: null, arrayBuffer: null };
        this.hasMipmap = false;
        this.gl = context;
        this.layer = layer;
        let gl = this.gl;
        this.transformMatrix = create();
        if (context instanceof WebGL2RenderingContext &&
            this.layer.getTextureType() === XRTextureType['texture-array']) {
            this.usesTextureArrayShaders = true;
        }
        if (this.usesTextureArrayShaders) {
            this.program = createProgram(gl, texArrayVertexShader$1, texArrayFragmentShader$1);
        }
        else {
            this.program = createProgram(gl, vertexShader$1, fragmentShader$1);
        }
        this.programInfo = {
            attribLocations: {
                a_position: gl.getAttribLocation(this.program, 'a_position'),
                a_texCoord: gl.getAttribLocation(this.program, 'a_texCoord'),
            },
            uniformLocations: {
                u_matrix: gl.getUniformLocation(this.program, 'u_matrix'),
                u_projectionMatrix: gl.getUniformLocation(this.program, 'u_projectionMatrix'),
            },
        };
        if (this.usesTextureArrayShaders) {
            this.programInfo.uniformLocations.u_layer = gl.getUniformLocation(this.program, 'u_layer');
        }
    }
    saveVaoState() {
        this.savedVaoState.vao = this.gl.getParameter(this.vaoGl.VERTEX_ARRAY_BINDING);
        this.savedVaoState.arrayBuffer = this.gl.getParameter(this.gl.ARRAY_BUFFER_BINDING);
    }
    restoreVaoState() {
        this.vaoGl.bindVertexArray(this.savedVaoState.vao);
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.savedVaoState.arrayBuffer);
        this.savedVaoState.vao = this.savedVaoState.arrayBuffer = null;
    }
    initialize() {
        let gl = this.gl;
        if (this.layer.isMediaLayer()) {
            this.mediaTexture = gl.createTexture();
            this.mediaTexturePolyfill = {
                texture: this.mediaTexture,
                textureFormat: gl.RGBA,
                width: this.layer.media.videoWidth,
                height: this.layer.media.videoHeight,
                type: XRTextureType.texture,
            };
            const existingTextureBinding = gl.getParameter(gl.TEXTURE_BINDING_2D);
            gl.bindTexture(gl.TEXTURE_2D, this.mediaTexture);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, this.layer.media.videoWidth, this.layer.media.videoHeight, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
            gl.bindTexture(gl.TEXTURE_2D, existingTextureBinding);
        }
        this._createVAOs();
    }
    render(session, frame) {
        this.saveVaoState();
        let gl = this.gl;
        let baseLayer = session.getBaseLayer();
        let basePose = frame.getViewerPose(session.getReferenceSpace());
        const existingActiveTexture = gl.getParameter(gl.ACTIVE_TEXTURE);
        for (let view of basePose.views) {
            let viewport = baseLayer.getViewport(view);
            gl.viewport(viewport.x, viewport.y, viewport.width, viewport.height);
            gl.activeTexture(gl.TEXTURE0);
            if (this.usesTextureArrayShaders) {
                if (gl instanceof WebGLRenderingContext) {
                    throw new Error('This should never happen; texture-arrays only supported on WebGL2.');
                }
                if (this.layer.isMediaLayer()) {
                    throw new Error('This should never happen. Media layers should never be created with texture-array');
                }
                const existingTextureBinding = gl.getParameter(gl.TEXTURE_BINDING_2D_ARRAY);
                gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.layer.colorTextures[0]);
                if (this.layer.isStatic) {
                    if (this.layer.needsRedraw === true) {
                        gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
                    }
                    this.hasMipmap = true;
                }
                else {
                    this.hasMipmap = this.layer.mipLevels > 0;
                }
                gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, this.hasMipmap ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
                gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, this.hasMipmap ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
                let layer = 0;
                if (this.layer.layout === XRLayerLayout.stereo) {
                    switch (view.eye) {
                        case 'right':
                            layer = 1;
                            break;
                    }
                }
                if (this._shouldUseStereoTexturePoints()) {
                    this._renderInternalStereo(session, frame, view, layer);
                }
                else {
                    this._renderInternal(session, frame, view, layer);
                }
                gl.activeTexture(existingActiveTexture);
                gl.bindTexture(gl.TEXTURE_2D_ARRAY, existingTextureBinding);
            }
            else {
                const existingTextureBinding = gl.getParameter(gl.TEXTURE_BINDING_2D);
                if (this.layer.isMediaLayer()) {
                    gl.bindTexture(gl.TEXTURE_2D, this.mediaTexture);
                    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
                    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.layer.media.videoWidth, this.layer.media.videoHeight, gl.RGBA, gl.UNSIGNED_BYTE, this.layer.media);
                }
                else if (this.layer.layout === XRLayerLayout.stereo) {
                    switch (view.eye) {
                        case 'right':
                            gl.bindTexture(gl.TEXTURE_2D, this.layer.colorTextures[1]);
                            break;
                        default:
                            gl.bindTexture(gl.TEXTURE_2D, this.layer.colorTextures[0]);
                    }
                }
                else {
                    gl.bindTexture(gl.TEXTURE_2D, this.layer.colorTextures[0]);
                }
                if (this.layer.isStatic) {
                    if (this.layer.needsRedraw === true) {
                        gl.generateMipmap(gl.TEXTURE_2D);
                    }
                    this.hasMipmap = true;
                }
                else {
                    this.hasMipmap = this.layer.mipLevels > 0;
                }
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, this.hasMipmap ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, this.hasMipmap ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
                if (this._shouldUseStereoTexturePoints()) {
                    this._renderInternalStereo(session, frame, view);
                }
                else {
                    this._renderInternal(session, frame, view);
                }
                gl.activeTexture(existingActiveTexture);
                gl.bindTexture(gl.TEXTURE_2D, existingTextureBinding);
            }
        }
        this.restoreVaoState();
    }
    createPositionPoints() {
        return new Float32Array([]);
    }
    createTextureUVs() {
        return new Float32Array([]);
    }
    _offsetTextureUVsByRect(texture, inArray, textureRect) {
        textureRect = textureRect !== null && textureRect !== void 0 ? textureRect : {
            x: 0,
            y: 0,
            width: texture.width,
            height: texture.height,
        };
        const uX = textureRect.x / texture.width;
        const vY = textureRect.y / texture.height;
        const uW = textureRect.width / texture.width;
        const vH = textureRect.height / texture.height;
        const outArray = [];
        for (let i = 0; i < inArray.length; i += 2) {
            let u = inArray[i];
            let v = inArray[i + 1];
            let newU = u * uW + uX;
            let newV = v * vH + vY;
            outArray[i] = newU;
            outArray[i + 1] = newV;
        }
        return new Float32Array(outArray);
    }
    _shouldUseStereoTexturePoints() {
        return (this.layer.layout === XRLayerLayout['stereo-left-right'] ||
            this.layer.layout === XRLayerLayout['stereo-top-bottom']);
    }
    _setStereoTextureBuffer(index) {
        let gl = this.gl;
        gl.enableVertexAttribArray(this.programInfo.attribLocations.a_texCoord);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.texcoordBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, this.stereoTexturePoints[index], gl.STATIC_DRAW);
        var size = 2;
        var type = gl.FLOAT;
        var normalize = false;
        var stride = 0;
        var offset = 0;
        gl.vertexAttribPointer(this.programInfo.attribLocations.a_texCoord, size, type, normalize, stride, offset);
        gl.bindBuffer(gl.ARRAY_BUFFER, null);
    }
    _recalculateVertices() {
        this.positionPoints = this.createPositionPoints();
        this.texturePoints = this.createTextureUVs();
        const viewport = {
            x: 0,
            y: 0,
            width: 1,
            height: 1,
        };
        if (this._shouldUseStereoTexturePoints()) {
            this.stereoTexturePoints = [];
            if (this.layer.isMediaLayer()) {
                initializeViewport(viewport, this.mediaTexturePolyfill, this.layer.layout, 0, 2);
                this.stereoTexturePoints[0] = this._offsetTextureUVsByRect(this.mediaTexturePolyfill, this.texturePoints, viewport);
                initializeViewport(viewport, this.mediaTexturePolyfill, this.layer.layout, 1, 2);
                this.stereoTexturePoints[1] = this._offsetTextureUVsByRect(this.mediaTexturePolyfill, this.texturePoints, viewport);
                if (this.layer.layout === XRLayerLayout['stereo-top-bottom']) {
                    [this.stereoTexturePoints[0], this.stereoTexturePoints[1]] = [
                        this.stereoTexturePoints[1],
                        this.stereoTexturePoints[0],
                    ];
                }
                return;
            }
            initializeViewport(viewport, this.layer.colorTexturesMeta[0], this.layer.layout, 0, 2);
            this.stereoTexturePoints[0] = this._offsetTextureUVsByRect(this.layer.colorTexturesMeta[0], this.texturePoints, viewport);
            initializeViewport(viewport, this.layer.colorTexturesMeta[0], this.layer.layout, 1, 2);
            this.stereoTexturePoints[1] = this._offsetTextureUVsByRect(this.layer.colorTexturesMeta[0], this.texturePoints, viewport);
            if (this.layer.layout === XRLayerLayout['stereo-top-bottom']) {
                [this.stereoTexturePoints[0], this.stereoTexturePoints[1]] = [
                    this.stereoTexturePoints[1],
                    this.stereoTexturePoints[0],
                ];
            }
        }
    }
    _createVAOs() {
        this._recalculateVertices();
        let gl = this.gl;
        this.vaoGl = applyVAOExtension(gl);
        this.saveVaoState();
        let positionBuffer = gl.createBuffer();
        this.vao = this.vaoGl.createVertexArray();
        this.vaoGl.bindVertexArray(this.vao);
        gl.enableVertexAttribArray(this.programInfo.attribLocations.a_position);
        gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
        const positions = this.positionPoints;
        gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
        var size = 3;
        var type = gl.FLOAT;
        var normalize = false;
        var stride = 0;
        var offset = 0;
        gl.vertexAttribPointer(this.programInfo.attribLocations.a_position, size, type, normalize, stride, offset);
        gl.enableVertexAttribArray(this.programInfo.attribLocations.a_texCoord);
        this.texcoordBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.texcoordBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, this.texturePoints, gl.STATIC_DRAW);
        var size = 2;
        var type = gl.FLOAT;
        var normalize = false;
        var stride = 0;
        var offset = 0;
        gl.vertexAttribPointer(this.programInfo.attribLocations.a_texCoord, size, type, normalize, stride, offset);
        this.restoreVaoState();
    }
    _renderInternal(session, frame, view, layer) {
        let gl = this.gl;
        const existingProgram = gl.getParameter(gl.CURRENT_PROGRAM);
        gl.useProgram(this.program);
        this.vaoGl.bindVertexArray(this.vao);
        if (this.usesTextureArrayShaders) {
            gl.uniform1i(this.programInfo.uniformLocations.u_layer, layer);
        }
        this._setTransformMatrix(session, frame, view);
        gl.uniformMatrix4fv(this.programInfo.uniformLocations.u_matrix, false, this.transformMatrix);
        gl.uniformMatrix4fv(this.programInfo.uniformLocations.u_projectionMatrix, false, view.projectionMatrix);
        var primitiveType = gl.TRIANGLES;
        var offset = 0;
        var count = this.positionPoints.length / 3;
        gl.drawArrays(primitiveType, offset, count);
        this.vaoGl.bindVertexArray(null);
        gl.useProgram(existingProgram);
    }
    _renderInternalStereo(session, frame, view, layer) {
        if (view.eye === 'none') {
            return this._renderInternal(session, frame, view);
        }
        let gl = this.gl;
        this.vaoGl.bindVertexArray(this.vao);
        const existingProgram = gl.getParameter(gl.CURRENT_PROGRAM);
        gl.useProgram(this.program);
        this._setStereoTextureBuffer(view.eye === 'right' ? 1 : 0);
        if (this.usesTextureArrayShaders) {
            gl.uniform1i(this.programInfo.uniformLocations.u_layer, layer);
        }
        this._setTransformMatrix(session, frame, view);
        gl.uniformMatrix4fv(this.programInfo.uniformLocations.u_matrix, false, this.transformMatrix);
        gl.uniformMatrix4fv(this.programInfo.uniformLocations.u_projectionMatrix, false, view.projectionMatrix);
        var primitiveType = gl.TRIANGLES;
        var offset = 0;
        var count = this.positionPoints.length / 3;
        gl.drawArrays(primitiveType, offset, count);
        this.vaoGl.bindVertexArray(null);
        gl.useProgram(existingProgram);
    }
    _setTransformMatrix(session, frame, view) {
        let objPose = frame.getPose(this.layer.space, session.getReferenceSpace());
        multiply(this.transformMatrix, objPose.transform.matrix, this.layer.transform.matrix);
        multiply(this.transformMatrix, view.transform.inverse.matrix, this.transformMatrix);
    }
}

class QuadRenderer extends CompositionLayerRenderer {
    constructor(layer, context) {
        super(layer, context);
        this.initialize();
    }
    createPositionPoints() {
        const width = this.layer.width;
        const height = this.layer.height;
        const z = 0;
        const positions = [
            -width,
            -height,
            z,
            width,
            -height,
            z,
            -width,
            height,
            z,
            -width,
            height,
            z,
            width,
            -height,
            z,
            width,
            height,
            z,
        ];
        return new Float32Array(positions);
    }
    createTextureUVs() {
        return new Float32Array([0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 0.0, 1.0, 1.0, 0.0, 1.0, 1.0]);
    }
}

class CylinderRenderer extends CompositionLayerRenderer {
    constructor(layer, context) {
        super(layer, context);
        this.segments = 16;
        this.initialize();
    }
    createPositionPoints() {
        const positions = [];
        const angle = this.layer.centralAngle;
        const height = this.layer.height;
        const radius = this.layer.radius;
        const radiansPerSegment = angle / this.segments;
        const theta = Math.PI / 2 - angle / 2;
        const unitCirclePositions = [];
        const firstUnitPoint = create$1();
        firstUnitPoint[0] = radius * Math.cos(theta);
        firstUnitPoint[1] = -radius * Math.sin(theta);
        unitCirclePositions.push(firstUnitPoint);
        for (let i = 0; i < this.segments; i++) {
            const nextPoint = create$1();
            nextPoint[0] = radius * Math.cos(theta + radiansPerSegment * (i + 1));
            nextPoint[1] = -radius * Math.sin(theta + radiansPerSegment * (i + 1));
            unitCirclePositions.push(nextPoint);
        }
        unitCirclePositions.reverse();
        for (let i = 0; i < this.segments; i++) {
            const u = unitCirclePositions[i];
            const v = unitCirclePositions[i + 1];
            positions.push(u[0], -height / 2, u[1]);
            positions.push(v[0], -height / 2, v[1]);
            positions.push(u[0], height / 2, u[1]);
            positions.push(u[0], height / 2, u[1]);
            positions.push(v[0], -height / 2, v[1]);
            positions.push(v[0], height / 2, v[1]);
        }
        return new Float32Array(positions);
    }
    createTextureUVs() {
        let textureUVs = [];
        const texturePercent = 1.0 / this.segments;
        for (let i = 0; i < this.segments; i++) {
            let leftX = texturePercent * i;
            let rightX = texturePercent * (i + 1);
            textureUVs.push(leftX, 0);
            textureUVs.push(rightX, 0);
            textureUVs.push(leftX, 1);
            textureUVs.push(leftX, 1);
            textureUVs.push(rightX, 0);
            textureUVs.push(rightX, 1);
        }
        return new Float32Array(textureUVs);
    }
}

class EquirectRenderer extends CompositionLayerRenderer {
    constructor(layer, context) {
        super(layer, context);
        this.segmentsPerAxis = 40;
        this.initialize();
    }
    createPositionPoints() {
        const positions = [];
        let radius = this.layer.radius;
        if (radius === 0) {
            radius = 25;
        }
        if (radius > 25) {
            radius = 25;
        }
        const horizAngle = this.layer.centralHorizontalAngle;
        const phi1 = this.layer.upperVerticalAngle + Math.PI / 2;
        const phi2 = this.layer.lowerVerticalAngle + Math.PI / 2;
        const startPhi = phi1;
        const endPhi = phi2;
        const startTheta = Math.PI / 2 - horizAngle / 2;
        const endTheta = startTheta + horizAngle;
        const phiRange = endPhi - startPhi;
        const thetaRange = endTheta - startTheta;
        const basePoints = [];
        for (let y = 0; y <= this.segmentsPerAxis; y++) {
            for (let x = 0; x <= this.segmentsPerAxis; x++) {
                const u = x / this.segmentsPerAxis;
                const v = y / this.segmentsPerAxis;
                let r = radius;
                let theta = endTheta - thetaRange * u;
                let phi = phiRange * v + startPhi;
                const ux = Math.cos(theta) * Math.sin(phi);
                const uy = Math.cos(phi);
                const uz = -Math.sin(theta) * Math.sin(phi);
                basePoints.push([r * ux, r * uy, r * uz]);
            }
        }
        const numVertsAround = this.segmentsPerAxis + 1;
        for (let x = 0; x < this.segmentsPerAxis; x++) {
            for (let y = 0; y < this.segmentsPerAxis; y++) {
                positions.push(...basePoints[y * numVertsAround + x]);
                positions.push(...basePoints[y * numVertsAround + x + 1]);
                positions.push(...basePoints[(y + 1) * numVertsAround + x]);
                positions.push(...basePoints[(y + 1) * numVertsAround + x]);
                positions.push(...basePoints[y * numVertsAround + x + 1]);
                positions.push(...basePoints[(y + 1) * numVertsAround + x + 1]);
            }
        }
        return new Float32Array(positions);
    }
    createTextureUVs() {
        const triUVs = [];
        const baseUVs = [];
        for (let y = 0; y <= this.segmentsPerAxis; y++) {
            for (let x = 0; x <= this.segmentsPerAxis; x++) {
                const u = x / this.segmentsPerAxis;
                const v = y / this.segmentsPerAxis;
                baseUVs.push([u, v]);
            }
        }
        const numVertsAround = this.segmentsPerAxis + 1;
        for (let x = 0; x < this.segmentsPerAxis; x++) {
            for (let y = 0; y < this.segmentsPerAxis; y++) {
                triUVs.push(...baseUVs[y * numVertsAround + x]);
                triUVs.push(...baseUVs[y * numVertsAround + x + 1]);
                triUVs.push(...baseUVs[(y + 1) * numVertsAround + x]);
                triUVs.push(...baseUVs[(y + 1) * numVertsAround + x]);
                triUVs.push(...baseUVs[y * numVertsAround + x + 1]);
                triUVs.push(...baseUVs[(y + 1) * numVertsAround + x + 1]);
            }
        }
        return new Float32Array(triUVs);
    }
}

const defaultCubeLayerInit = {
    colorFormat: 0x1908,
    mipLevels: 1,
    layout: XRLayerLayout.mono,
    isStatic: false,
    space: null,
    viewPixelHeight: 0,
    viewPixelWidth: 0,
};
class XRCubeLayer extends XRCompositionLayerPolyfill {
    constructor(init = defaultCubeLayerInit) {
        super();
        if (!isReferenceSpace(init.space)) {
            throw new TypeError("XRCubeLayer's space needs to be an XRReferenceSpace");
        }
        this.init = Object.assign(Object.assign({}, defaultCubeLayerInit), init);
        this.space = this.init.space;
        this.isStatic = this.init.isStatic;
        if (this.init.orientation) {
            this.orientation = DOMPointReadOnly.fromPoint(this.init.orientation);
        }
        else {
            this.orientation = new DOMPointReadOnly();
        }
        switch (this.init.layout) {
            case XRLayerLayout.default:
            case XRLayerLayout['stereo-left-right']:
            case XRLayerLayout['stereo-top-bottom']:
                throw new TypeError('Invalid layout format for XRCubeLayer');
        }
        this.layout = this.init.layout;
        this.needsRedraw = true;
    }
    initialize(session, context) {
        super.initialize(session, context);
        this._allocateColorTexturesInternal();
        this._allocateDepthStencilTexturesInternal();
    }
    _allocateColorTexturesInternal() {
        this._colorTextures = [];
        this._texturesMeta = [];
        if (this.layout === XRLayerLayout.mono) {
            const colorTexture = this._createCubeColorTexture();
            this._texturesMeta.push(colorTexture);
            this._colorTextures.push(colorTexture.texture);
            return;
        }
        else {
            const texture1 = this._createCubeColorTexture();
            const texture2 = this._createCubeColorTexture();
            this._texturesMeta.push(texture1, texture2);
            this._colorTextures.push(texture1.texture, texture2.texture);
            return;
        }
    }
    _allocateDepthStencilTexturesInternal() {
        this._depthStencilTextures = [];
        if (!this.init.depthFormat) {
            return;
        }
        if (this.context instanceof WebGLRenderingContext) {
            let depthExtension = this.context.getExtension('WEBGL_depth_texture');
            if (!depthExtension) {
                throw new TypeError('Depth textures not supported in the current context');
            }
        }
        if (this.layout === XRLayerLayout.mono) {
            const depthTexture = this._createCubeDepthTexture();
            this._depthStencilTextures.push(depthTexture.texture);
            return;
        }
        else {
            const texture1 = this._createCubeDepthTexture();
            const texture2 = this._createCubeDepthTexture();
            this._depthStencilTextures.push(texture1.texture, texture2.texture);
            return;
        }
    }
    _createCubeColorTexture() {
        let texture = this.context.createTexture();
        let textureMeta = {
            width: this.init.viewPixelWidth,
            height: this.init.viewPixelHeight,
            layers: 1,
            type: XRTextureType.texture,
            textureFormat: this.init.colorFormat,
            texture,
        };
        const existingTextureBinding = this.context.getParameter(this.context.TEXTURE_BINDING_CUBE_MAP);
        this.context.bindTexture(this.context.TEXTURE_CUBE_MAP, texture);
        for (let i = 0; i < 6; i++) {
            this.context.texImage2D(this.context.TEXTURE_CUBE_MAP_POSITIVE_X + i, 0, textureMeta.textureFormat, textureMeta.width, textureMeta.height, 0, textureMeta.textureFormat, this.context.UNSIGNED_BYTE, null);
        }
        this.context.bindTexture(this.context.TEXTURE_CUBE_MAP, existingTextureBinding);
        return textureMeta;
    }
    _createCubeDepthTexture() {
        let texture = this.context.createTexture();
        let textureMeta = {
            width: this.init.viewPixelWidth,
            height: this.init.viewPixelHeight,
            layers: 1,
            type: XRTextureType.texture,
            textureFormat: this.init.depthFormat,
            texture,
        };
        const existingTextureBinding = this.context.getParameter(this.context.TEXTURE_BINDING_CUBE_MAP);
        this.context.bindTexture(this.context.TEXTURE_CUBE_MAP, texture);
        let internalFormat = this.init.depthFormat;
        if (this.context instanceof WebGL2RenderingContext) {
            if (internalFormat === this.context.DEPTH_COMPONENT) {
                internalFormat = this.context.DEPTH_COMPONENT24;
            }
            if (internalFormat === this.context.DEPTH_STENCIL) {
                internalFormat = this.context.DEPTH24_STENCIL8;
            }
        }
        for (let i = 0; i < 6; i++) {
            this.context.texImage2D(this.context.TEXTURE_CUBE_MAP_POSITIVE_X + i, 0, internalFormat, textureMeta.width, textureMeta.height, 0, textureMeta.textureFormat, this.context.UNSIGNED_INT, null);
        }
        this.context.bindTexture(this.context.TEXTURE_CUBE_MAP, existingTextureBinding);
        return textureMeta;
    }
    getTextureType() {
        return XRTextureType.texture;
    }
}

const glsl$2 = (x) => x;
const vertexShader$2 = glsl$2 `
attribute vec4 a_position;
uniform mat4 u_projectionMatrix;
uniform mat4 u_matrix;
varying vec3 v_normal;

void main() {
   gl_Position = u_projectionMatrix * u_matrix * a_position;

   v_normal = normalize(a_position.xyz);
}
`;
const fragmentShader$2 = glsl$2 `
precision mediump float;

varying vec3 v_normal;

uniform samplerCube u_texture;

void main() {
   gl_FragColor = textureCube(u_texture, normalize(v_normal));
}
`;
class CubeRenderer {
    constructor(layer, gl) {
        this.savedVaoState = { vao: null, arrayBuffer: null };
        this.hasMipmap = false;
        this.layer = layer;
        this.gl = gl;
        this.transformMatrix = create();
        this.program = createProgram(gl, vertexShader$2, fragmentShader$2);
        this.programInfo = {
            attribLocations: {
                a_position: gl.getAttribLocation(this.program, 'a_position'),
            },
            uniformLocations: {
                u_matrix: gl.getUniformLocation(this.program, 'u_matrix'),
                u_texture: gl.getUniformLocation(this.program, 'u_texture'),
                u_projectionMatrix: gl.getUniformLocation(this.program, 'u_projectionMatrix'),
            },
        };
        this._createVAOs();
    }
    saveVaoState() {
        this.savedVaoState.vao = this.gl.getParameter(this.vaoGl.VERTEX_ARRAY_BINDING);
        this.savedVaoState.arrayBuffer = this.gl.getParameter(this.gl.ARRAY_BUFFER_BINDING);
    }
    restoreVaoState() {
        this.vaoGl.bindVertexArray(this.savedVaoState.vao);
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.savedVaoState.arrayBuffer);
        this.savedVaoState.vao = this.savedVaoState.arrayBuffer = null;
    }
    render(session, frame) {
        this.saveVaoState();
        let gl = this.gl;
        let baseLayer = session.getBaseLayer();
        let basePose = frame.getViewerPose(session.getReferenceSpace());
        const existingActiveTexture = gl.getParameter(gl.ACTIVE_TEXTURE);
        for (let view of basePose.views) {
            let viewport = baseLayer.getViewport(view);
            gl.viewport(viewport.x, viewport.y, viewport.width, viewport.height);
            gl.activeTexture(gl.TEXTURE0);
            const existingTextureBinding = gl.getParameter(gl.TEXTURE_BINDING_CUBE_MAP);
            if (this.layer.layout === XRLayerLayout.stereo) {
                const index = view.eye === 'right' ? 1 : 0;
                gl.bindTexture(gl.TEXTURE_CUBE_MAP, this.layer.colorTextures[index]);
            }
            else {
                gl.bindTexture(gl.TEXTURE_CUBE_MAP, this.layer.colorTextures[0]);
            }
            if (this.layer.isStatic) {
                if (this.layer.needsRedraw === true) {
                    gl.generateMipmap(gl.TEXTURE_CUBE_MAP);
                }
                this.hasMipmap = true;
            }
            else {
                this.hasMipmap = this.layer.mipLevels > 0;
            }
            gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAG_FILTER, this.hasMipmap ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MIN_FILTER, this.hasMipmap ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
            this._renderInternal(this.layer.orientation, view);
            gl.activeTexture(existingActiveTexture);
            gl.bindTexture(gl.TEXTURE_CUBE_MAP, existingTextureBinding);
        }
        this.restoreVaoState();
    }
    createPositionPoints() {
        const w = 0.5;
        const positions = [
            -w, -w, -w,
            -w, w, -w,
            w, -w, -w,
            -w, w, -w,
            w, w, -w,
            w, -w, -w,
            -w, -w, w,
            w, -w, w,
            -w, w, w,
            -w, w, w,
            w, -w, w,
            w, w, w,
            -w, w, -w,
            -w, w, w,
            w, w, -w,
            -w, w, w,
            w, w, w,
            w, w, -w,
            -w, -w, -w,
            w, -w, -w,
            -w, -w, w,
            -w, -w, w,
            w, -w, -w,
            w, -w, w,
            -w, -w, -w,
            -w, -w, w,
            -w, w, -w,
            -w, -w, w,
            -w, w, w,
            -w, w, -w,
            w, -w, -w,
            w, w, -w,
            w, -w, w,
            w, -w, w,
            w, w, -w,
            w, w, w,
        ];
        return new Float32Array(positions);
    }
    _renderInternal(orientation, view) {
        let gl = this.gl;
        const existingProgram = gl.getParameter(gl.CURRENT_PROGRAM);
        gl.useProgram(this.program);
        this.vaoGl.bindVertexArray(this.vao);
        fromQuat(this.transformMatrix, [
            orientation.x,
            orientation.y,
            orientation.z,
            orientation.w,
        ]);
        if (!this._poseOrientationMatrix) {
            this._poseOrientationMatrix = create();
        }
        fromQuat(this._poseOrientationMatrix, [
            view.transform.inverse.orientation.x,
            view.transform.inverse.orientation.y,
            view.transform.inverse.orientation.z,
            view.transform.inverse.orientation.w,
        ]);
        multiply(this.transformMatrix, this.transformMatrix, this._poseOrientationMatrix);
        gl.uniformMatrix4fv(this.programInfo.uniformLocations.u_matrix, false, this.transformMatrix);
        gl.uniformMatrix4fv(this.programInfo.uniformLocations.u_projectionMatrix, false, view.projectionMatrix);
        gl.uniform1i(this.programInfo.uniformLocations.u_texture, 0);
        var primitiveType = gl.TRIANGLES;
        var offset = 0;
        var count = this.positionPoints.length / 3;
        gl.drawArrays(primitiveType, offset, count);
        this.vaoGl.bindVertexArray(null);
        gl.useProgram(existingProgram);
    }
    _recalculateVertices() {
        this.positionPoints = this.createPositionPoints();
    }
    _createVAOs() {
        this._recalculateVertices();
        let gl = this.gl;
        this.vaoGl = applyVAOExtension(gl);
        this.saveVaoState();
        let positionBuffer = gl.createBuffer();
        this.vao = this.vaoGl.createVertexArray();
        this.vaoGl.bindVertexArray(this.vao);
        gl.enableVertexAttribArray(this.programInfo.attribLocations.a_position);
        gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
        const positions = this.positionPoints;
        gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
        var size = 3;
        var type = gl.FLOAT;
        var normalize = false;
        var stride = 0;
        var offset = 0;
        gl.vertexAttribPointer(this.programInfo.attribLocations.a_position, size, type, normalize, stride, offset);
        this.restoreVaoState();
    }
}

class XRSessionWithLayer {
    constructor() {
        this.mode = 'inline';
        this.layers = [];
        this.views = [];
        this.initializedViews = false;
        this.isPolyfillActive = false;
        this.taskQueue = [];
    }
    requestAnimationFrame(animationFrameCallback) {
        if (!this.injectedFrameCallback) {
            this.injectedFrameCallback = (time, frame) => {
                let gl = this.context;
                if (!this.initializedViews && this.referenceSpace) {
                    let pose = frame.getViewerPose(this.referenceSpace);
                    if (pose) {
                        this.views = pose.views;
                        this.initializedViews = true;
                    }
                }
                if (this.isPolyfillActive && this.initializedViews) {
                    if (!this.tempFramebuffer) {
                        this.tempFramebuffer = gl.createFramebuffer();
                    }
                    gl.bindFramebuffer(gl.FRAMEBUFFER, this.tempFramebuffer);
                    const existingClearColor = gl.getParameter(gl.COLOR_CLEAR_VALUE);
                    const existingFrameBuffer = gl.getParameter(gl.FRAMEBUFFER_BINDING);
                    gl.clearColor(0, 0, 0, 0);
                    for (let layer of this.layers) {
                        if (!(layer instanceof XRProjectionLayer)) {
                            continue;
                        }
                        for (let i = 0; i < layer.colorTextures.length; i++) {
                            let textureType = layer.colorTexturesMeta[i].type;
                            if (textureType === XRTextureType['texture-array']) ;
                            else {
                                gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, layer.colorTextures[i], 0);
                                if (layer.depthStencilTextures && i < layer.depthStencilTextures.length) {
                                    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, layer.depthStencilTextures[i], 0);
                                }
                                else {
                                    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, null, 0);
                                }
                                gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
                            }
                        }
                    }
                    gl.bindFramebuffer(gl.FRAMEBUFFER, existingFrameBuffer);
                    gl.clearColor(existingClearColor[0], existingClearColor[1], existingClearColor[2], existingClearColor[3]);
                }
                animationFrameCallback(time, frame);
                if (this.isPolyfillActive && this.initializedViews) {
                    let prevBlend = gl.isEnabled(gl.BLEND);
                    let prevDepthTest = gl.isEnabled(gl.DEPTH_TEST);
                    let prevCullFace = gl.isEnabled(gl.CULL_FACE);
                    const existingFrameBuffer = gl.getParameter(gl.FRAMEBUFFER_BINDING);
                    const existingClearColor = gl.getParameter(gl.COLOR_CLEAR_VALUE);
                    gl.bindFramebuffer(gl.FRAMEBUFFER, this.getBaseLayer().framebuffer);
                    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
                    gl.clearColor(existingClearColor[0], existingClearColor[1], existingClearColor[2], existingClearColor[3]);
                    gl.enable(gl.BLEND);
                    gl.disable(gl.DEPTH_TEST);
                    gl.disable(gl.CULL_FACE);
                    let prevBlendSrcRGB = gl.getParameter(gl.BLEND_SRC_RGB);
                    let prevBlendSrcAlpha = gl.getParameter(gl.BLEND_SRC_ALPHA);
                    let prevBlendDestRGB = gl.getParameter(gl.BLEND_DST_RGB);
                    let prevBlendDestAlpha = gl.getParameter(gl.BLEND_DST_ALPHA);
                    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
                    for (let layer of this.layers) {
                        if (!this.renderers) {
                            this.renderers = new WeakMap();
                        }
                        if (layer instanceof XRProjectionLayer) {
                            if (!this.renderers.has(layer)) {
                                this.renderers.set(layer, createProjectionRenderer(layer, this.context));
                            }
                            const renderer = this.renderers.get(layer);
                            renderer.render(this);
                        }
                        else if (layer instanceof XRQuadLayer) {
                            if (!this.renderers.has(layer)) {
                                this.renderers.set(layer, new QuadRenderer(layer, this.context));
                            }
                            const renderer = this.renderers.get(layer);
                            renderer.render(this, frame);
                        }
                        else if (layer instanceof XRCylinderLayer) {
                            if (!this.renderers.has(layer)) {
                                this.renderers.set(layer, new CylinderRenderer(layer, this.context));
                            }
                            const renderer = this.renderers.get(layer);
                            renderer.render(this, frame);
                        }
                        else if (layer instanceof XREquirectLayer) {
                            if (!this.renderers.has(layer)) {
                                this.renderers.set(layer, new EquirectRenderer(layer, this.context));
                            }
                            const renderer = this.renderers.get(layer);
                            renderer.render(this, frame);
                        }
                        else if (layer instanceof XRCubeLayer) {
                            if (!this.renderers.has(layer)) {
                                this.renderers.set(layer, new CubeRenderer(layer, this.context));
                            }
                            const renderer = this.renderers.get(layer);
                            renderer.render(this, frame);
                        }
                        else {
                            const webglLayer = layer;
                            if (webglLayer.framebuffer === null) {
                                continue;
                            }
                            if (gl instanceof WebGL2RenderingContext) {
                                gl.bindFramebuffer(gl.READ_FRAMEBUFFER, webglLayer.framebuffer);
                                gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.getBaseLayer().framebuffer);
                                gl.blitFramebuffer(0, 0, webglLayer.framebufferWidth, webglLayer.framebufferHeight, 0, 0, this.getBaseLayer().framebufferWidth, this.getBaseLayer().framebufferHeight, gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT, gl.LINEAR);
                            }
                            else {
                                console.warn('GL blitFramebuffer is not supported on WebGL1, so XRWebGLLayers may not show up properly when polyfilled.');
                            }
                        }
                    }
                    if (!prevBlend) {
                        gl.disable(gl.BLEND);
                    }
                    if (prevDepthTest) {
                        gl.enable(gl.DEPTH_TEST);
                    }
                    if (prevCullFace) {
                        gl.enable(gl.CULL_FACE);
                    }
                    gl.blendFuncSeparate(prevBlendSrcRGB, prevBlendDestRGB, prevBlendSrcAlpha, prevBlendDestAlpha);
                    gl.bindFramebuffer(gl.FRAMEBUFFER, existingFrameBuffer);
                    while (this.taskQueue.length > 0) {
                        const task = this.taskQueue.shift();
                        task();
                    }
                }
            };
        }
        this._requestAnimationFrame(this.injectedFrameCallback);
    }
    updateRenderState(XRRenderStateInit) {
        this.existingBaseLayer = XRRenderStateInit.baseLayer;
        if (XRRenderStateInit.layers) {
            this.layers = XRRenderStateInit.layers;
        }
        if (!this.activeRenderState) {
            this.createActiveRenderState();
        }
        this.activeRenderState = Object.assign(Object.assign({}, this.activeRenderState), XRRenderStateInit);
        if (!XRRenderStateInit.layers) {
            this._updateRenderState(XRRenderStateInit);
            return;
        }
        let layerRenderStateInit = Object.assign({}, XRRenderStateInit);
        delete layerRenderStateInit.layers;
        let context = undefined;
        for (let layer of this.layers) {
            if (layer instanceof XRCompositionLayerPolyfill) {
                context = layer.getContext();
                break;
            }
        }
        if (!context && !this.context) {
            console.log('No existing context! Have the session make one');
            const canvas = document.createElement('canvas');
            context = canvas.getContext('webgl2', { xrCompatible: true });
            if (!context) {
                context = canvas.getContext('webgl', { xrCompatible: true });
            }
            if (!context) {
                throw new Error('No webGL support detected.');
            }
            document.body.appendChild(context.canvas);
            function onResize() {
                context.canvas.width = context.canvas.clientWidth * window.devicePixelRatio;
                context.canvas.height = context.canvas.clientHeight * window.devicePixelRatio;
            }
            window.addEventListener('resize', onResize);
            onResize();
        }
        this.createInternalLayer(context);
        this.isPolyfillActive = true;
        this._updateRenderState(Object.assign(Object.assign({}, layerRenderStateInit), { baseLayer: this.internalLayer }));
    }
    initializeSession(mode) {
        this.mode = mode;
        this
            .requestReferenceSpace('local')
            .then((refSpace) => {
            this.referenceSpace = refSpace;
        })
            .catch((e) => {
        });
        this.requestReferenceSpace('viewer').then((viewerSpace) => {
            this.viewerSpace = viewerSpace;
        });
    }
    getBaseLayer(context) {
        if (!this.internalLayer && !this.existingBaseLayer && context) {
            this.createInternalLayer(context);
        }
        return this.internalLayer || this.existingBaseLayer;
    }
    getReferenceSpace() {
        return !this.referenceSpace ? this.viewerSpace : this.referenceSpace;
    }
    getViewerSpace() {
        return this.viewerSpace;
    }
    queueTask(task) {
        this.taskQueue.push(task);
    }
    get renderState() {
        if (!this.activeRenderState) {
            this.createActiveRenderState();
        }
        return this.activeRenderState;
    }
    get internalViews() {
        return this.views;
    }
    getViewIndex(view) {
        for (let i = 0; i < this.views.length; i++) {
            let testView = this.views[i];
            if (view.eye === testView.eye &&
                view.recommendedViewportScale === testView.recommendedViewportScale) {
                return i;
            }
        }
        return -1;
    }
    createInternalLayer(context) {
        if (!context && this.internalLayer) {
            return this.internalLayer;
        }
        if (context === this.context && this.internalLayer) {
            return this.internalLayer;
        }
        const _global = getGlobal();
        this.internalLayer = new _global.XRWebGLLayer(this, context);
        this.setContext(context);
        return this.internalLayer;
    }
    setContext(context) {
        this.context = context;
        this.tempFramebuffer = context.createFramebuffer();
        this.renderers = new WeakMap();
    }
    createActiveRenderState() {
        const _global = getGlobal();
        let prototypeNames = Object.getOwnPropertyNames(_global.XRRenderState.prototype);
        const renderStateClone = {};
        for (let item of prototypeNames) {
            renderStateClone[item] = this._renderState[item];
        }
        renderStateClone.layers = [];
        this.activeRenderState = renderStateClone;
    }
}

class XRWebGLSubImagePolyfill {
    constructor() {
        this.viewport = {
            x: 0,
            y: 0,
            width: 0,
            height: 0,
        };
    }
}

class XRWebGLBindingPolyfill {
    constructor(session, context) {
        this.session = session;
        this.context = context;
        this.subImageCache = new SubImageCache();
    }
    createProjectionLayer(init = defaultXRProjectionLayerInit) {
        const layer = new XRProjectionLayer(init);
        if (this.session.ended) {
            throw new Error('Session has ended');
        }
        if (this.context.isContextLost()) {
            throw new Error('context is lost');
        }
        layer.initialize(this.session, this.context);
        return layer;
    }
    createQuadLayer(init = defaultQuadLayerInit) {
        if (this.session.ended) {
            throw new Error('Session has ended');
        }
        if (this.context.isContextLost()) {
            throw new Error('context is lost');
        }
        if (init.layout === XRLayerLayout.default) {
            throw new TypeError('Trying to create a quad layer with default layout');
        }
        const layer = new XRQuadLayer(init);
        layer.initialize(this.session, this.context);
        return layer;
    }
    createCylinderLayer(init = defaultCylinderLayerInit) {
        if (this.session.ended) {
            throw new Error('Session has ended');
        }
        if (this.context.isContextLost()) {
            throw new Error('context is lost');
        }
        if (init.layout === XRLayerLayout.default) {
            throw new TypeError('Cylinder Layer cannot have a default layout');
        }
        const layer = new XRCylinderLayer(init);
        layer.initialize(this.session, this.context);
        return layer;
    }
    createEquirectLayer(init = defaultEquirectLayerInit) {
        if (this.session.ended) {
            throw new Error('Session has ended');
        }
        if (this.context.isContextLost()) {
            throw new Error('context is lost');
        }
        if (init.layout === XRLayerLayout.default) {
            throw new TypeError('Equirect Layer cannot have a default layout');
        }
        if (!isReferenceSpace(init.space)) {
            throw new TypeError('Equirect layer requires an XRReferenceSpace');
        }
        let layer = new XREquirectLayer(init);
        layer.initialize(this.session, this.context);
        return layer;
    }
    createCubeLayer(init) {
        if (this.session.ended) {
            throw new Error('Session has ended');
        }
        if (this.context.isContextLost()) {
            throw new Error('context is lost');
        }
        if (!(this.context instanceof WebGL2RenderingContext)) {
            throw new Error('XRCubeLayer only work on WebGL2');
        }
        if (!isReferenceSpace(init.space)) {
            throw new TypeError('XRCubeLayer requires a space of type XRReferenceSpace');
        }
        let layer = new XRCubeLayer(init);
        layer.initialize(this.session, this.context);
        return layer;
    }
    getSubImage(layer, frame, eye = 'none') {
        if (layer.isStatic && (layer.needsRedraw === false)) {
            throw new Error('Invalid state for subimage creation');
        }
        let existingSubImage = this.subImageCache.tryGetCachedSubImage(this.context, layer, eye);
        if (existingSubImage) {
            return existingSubImage;
        }
        let subimage = new XRWebGLSubImagePolyfill();
        if (layer instanceof XRProjectionLayer) {
            throw new TypeError();
        }
        if (layer.layout === XRLayerLayout.default) {
            throw new TypeError();
        }
        if (!this.validateStateofSubImageCreation(layer, frame)) {
            throw new Error('Invalid state for subimage creation');
        }
        let index = 0;
        if (layer.layout === XRLayerLayout.stereo) {
            if (eye === 'none') {
                throw new TypeError();
            }
            if (eye === 'right') {
                index = 1;
            }
        }
        if (layer.getTextureType() === XRTextureType['texture-array']) {
            subimage.imageIndex = index;
        }
        else {
            subimage.imageIndex = 0;
        }
        let _textureIndex = 0;
        if (layer.getTextureType() === XRTextureType.texture) {
            subimage.colorTexture = layer.colorTextures[index];
            _textureIndex = index;
        }
        else {
            subimage.colorTexture = layer.colorTextures[0];
            _textureIndex = 0;
        }
        if (!layer.depthStencilTextures || !layer.depthStencilTextures.length) {
            subimage.depthStencilTexture = null;
        }
        else if (layer.getTextureType() === XRTextureType.texture) {
            subimage.depthStencilTexture = layer.depthStencilTextures[index];
        }
        else {
            subimage.depthStencilTexture = layer.depthStencilTextures[0];
        }
        const layerMeta = layer.colorTexturesMeta[_textureIndex];
        subimage.textureWidth = layerMeta.width;
        subimage.textureHeight = layerMeta.height;
        let viewsPerTexture = 1;
        if (layer.layout === XRLayerLayout['stereo-left-right'] ||
            layer.layout === XRLayerLayout['stereo-top-bottom']) {
            viewsPerTexture = 2;
        }
        initializeViewport(subimage.viewport, layerMeta, layer.layout, index, viewsPerTexture);
        this.session.queueTask(() => {
            layer.needsRedraw = false;
        });
        this.subImageCache.cacheSubImage(subimage, this.context, layer, eye);
        return subimage;
    }
    getViewSubImage(layer, view) {
        let existingSubImage = this.subImageCache.tryGetCachedViewSubImage(this.context, layer, view);
        if (existingSubImage) {
            return existingSubImage;
        }
        let subimage = new XRWebGLSubImagePolyfill();
        let session = this.session;
        if (!session.internalViews || !session.internalViews.length) {
            console.warn('Tried to get view sub image before we have any views');
            return subimage;
        }
        let index = session.getViewIndex(view);
        let _textureIndex = 0;
        if (layer.getTextureType() === XRTextureType['texture-array']) {
            subimage.imageIndex = index;
        }
        else {
            subimage.imageIndex = 0;
        }
        if (layer.layout === XRLayerLayout.default &&
            layer.getTextureType() === XRTextureType.texture) {
            subimage.colorTexture = layer.colorTextures[index];
            _textureIndex = index;
        }
        else {
            subimage.colorTexture = layer.colorTextures[0];
            _textureIndex = 0;
        }
        if (layer.depthStencilTextures.length === 0) {
            subimage.depthStencilTexture = null;
        }
        else if (layer.layout === XRLayerLayout.default &&
            layer.getTextureType() === XRTextureType.texture) {
            subimage.depthStencilTexture = layer.depthStencilTextures[index];
        }
        else {
            subimage.depthStencilTexture = layer.depthStencilTextures[0];
        }
        subimage.textureWidth = layer.colorTexturesMeta[_textureIndex].width;
        subimage.textureHeight = layer.colorTexturesMeta[_textureIndex].height;
        initializeViewport(subimage.viewport, layer.colorTexturesMeta[_textureIndex], layer.layout, index, session.internalViews.length);
        layer.needsRedraw = false;
        this.subImageCache.cacheViewSubImage(subimage, this.context, layer, view);
        return subimage;
    }
    validateStateofSubImageCreation(layer, frame) {
        if (frame.session !== layer.session) {
            return false;
        }
        if (this.session !== layer.session) {
            return false;
        }
        if (this.context !== layer.context) {
            return false;
        }
        if (!layer.colorTextures || !layer.colorTextures.length) {
            return false;
        }
        if (layer.isStatic && layer.needsRedraw === false) {
            return false;
        }
        return true;
    }
}
class SubImageCache {
    constructor() {
        this.cache = new Map();
        this.viewCache = new Map();
    }
    cacheSubImage(subimage, context, layer, eye) {
        let eyeMap = new Map();
        eyeMap.set(eye, subimage);
        let layerMap = new Map();
        layerMap.set(layer, eyeMap);
        this.cache.set(context, layerMap);
    }
    tryGetCachedSubImage(context, layer, eye) {
        var _a, _b;
        return (_b = (_a = this.cache.get(context)) === null || _a === void 0 ? void 0 : _a.get(layer)) === null || _b === void 0 ? void 0 : _b.get(eye);
    }
    cacheViewSubImage(subimage, context, layer, view) {
        let viewMap = new Map();
        viewMap.set(view, subimage);
        let layerMap = new Map();
        layerMap.set(layer, viewMap);
        this.viewCache.set(context, layerMap);
    }
    tryGetCachedViewSubImage(context, layer, view) {
        var _a, _b;
        return (_b = (_a = this.viewCache.get(context)) === null || _a === void 0 ? void 0 : _a.get(layer)) === null || _b === void 0 ? void 0 : _b.get(view);
    }
}

const isLayersNativelySupported = (global) => {
    if (!global.navigator.xr) {
        return false;
    }
    if (global.XRMediaBinding && global.XRWebGLBinding) {
        return true;
    }
    return false;
};

class WebXRLayersPolyfill {
    constructor() {
        this.injected = false;
        const _global = getGlobal();
        this._injectPolyfill(_global);
    }
    _injectPolyfill(global) {
        if (!('xr' in global.navigator)) {
            throw new Error('WebXR Layers polyfill requires WebXR support.');
        }
        if (this.injected === true) {
            console.warn('Polyfill has already been injected...');
        }
        if (isLayersNativelySupported(global)) {
            return;
        }
        this._polyfillRequiredLayersFeature(global);
        this._polyfillXRSession(global);
        global.XRWebGLBinding = XRWebGLBindingPolyfill;
        global.XRMediaBinding = XRMediaBindingPolyfill;
        this.injected = true;
        console.log('Injected Layers Polyfill');
    }
    _polyfillXRSession(global) {
        global.XRSession.prototype._updateRenderState = global.XRSession.prototype.updateRenderState;
        global.XRSession.prototype._requestAnimationFrame =
            global.XRSession.prototype.requestAnimationFrame;
        let renderStateGetter = Object.getOwnPropertyDescriptor(global.XRSession.prototype, 'renderState');
        Object.defineProperty(global.XRSession.prototype, '_renderState', renderStateGetter);
        let polyfillRenderStateGetter = Object.getOwnPropertyDescriptor(XRSessionWithLayer.prototype, 'renderState');
        Object.defineProperty(global.XRSession.prototype, 'renderState', polyfillRenderStateGetter);
        let prototypeNames = Object.getOwnPropertyNames(XRSessionWithLayer.prototype);
        for (let item of prototypeNames) {
            let propertyDescriptor = Object.getOwnPropertyDescriptor(XRSessionWithLayer.prototype, item);
            Object.defineProperty(global.XRSession.prototype, item, propertyDescriptor);
        }
    }
    _polyfillRequiredLayersFeature(global) {
        const existingRequestSession = global.navigator.xr.requestSession;
        Object.defineProperty(global.navigator.xr, 'requestSessionInternal', { writable: true });
        global.navigator.xr.requestSessionInternal = existingRequestSession;
        const newRequestSession = (sessionMode, sessionInit) => {
            const modifiedSessionPromise = (mode, init) => {
                return global.navigator.xr.requestSessionInternal(mode, init).then((session) => {
                    Object.assign(session, new XRSessionWithLayer());
                    let polyfilledSession = session;
                    polyfilledSession.initializeSession(sessionMode);
                    return Promise.resolve(polyfilledSession);
                });
            };
            if (sessionMode !== 'immersive-vr') {
                return modifiedSessionPromise(sessionMode, sessionInit);
            }
            if (!sessionInit) {
                return modifiedSessionPromise(sessionMode, sessionInit);
            }
            if (sessionInit.requiredFeatures && sessionInit.requiredFeatures.indexOf('layers') > -1) {
                const sessionInitClone = Object.assign({}, sessionInit);
                const reqFeatures = [...sessionInit.requiredFeatures];
                const layersIndex = reqFeatures.indexOf('layers');
                reqFeatures.splice(layersIndex, 1);
                sessionInitClone.requiredFeatures = reqFeatures;
                return modifiedSessionPromise(sessionMode, sessionInitClone);
            }
            return modifiedSessionPromise(sessionMode, sessionInit);
        };
        Object.defineProperty(global.navigator.xr, 'requestSession', { writable: true });
        global.navigator.xr.requestSession = newRequestSession;
    }
}

/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
const DEFAULTS = {
    ipd: 0.063,
    fovy: Math.PI / 2,
    headsetPosition: new Vector3(0, 1.6, 0),
    headsetQuaternion: new Quaternion(),
    stereoEnabled: false,
};
const Z_INDEX_SEM_CANVAS = 1;
const Z_INDEX_APP_CANVAS = 2;
const Z_INDEX_DEVUI_CANVAS = 3;
const Z_INDEX_VISIBILITY_MASK = 4;
const Z_INDEX_DEVUI_CONTAINER = 5;
// scratch buffers for per-frame view offset updates (consumed synchronously
// within updateViews via mat4.fromTranslation, never returned to callers)
const leftViewOffsetScratch = create$4();
const rightViewOffsetScratch = create$4();
/**
 * XRDevice is not a standard API class outlined in the WebXR Device API Specifications
 * Instead, it serves as an user-facing interface to control the emulated XR Device
 */
class XRDevice {
    constructor(deviceConfig, deviceOptions = {}) {
        var _a, _b, _c, _d, _e, _f, _g, _h;
        this.version = VERSION;
        const globalSpace = new GlobalSpace();
        const viewerSpace = new XRReferenceSpace(XRReferenceSpaceType.Viewer, globalSpace);
        const viewSpaces = {
            [XREye.Left]: new XRSpace(viewerSpace),
            [XREye.Right]: new XRSpace(viewerSpace),
            [XREye.None]: new XRSpace(viewerSpace),
        };
        const controllerConfig = deviceConfig.controllerConfig;
        const controllers = {};
        if (controllerConfig) {
            Object.values(XRHandedness).forEach((handedness) => {
                if (controllerConfig.layout[handedness]) {
                    controllers[handedness] = new XRController(controllerConfig, handedness, globalSpace);
                }
            });
        }
        const hands = {
            [XRHandedness.Left]: new XRHandInput(oculusHandConfig, XRHandedness.Left, globalSpace),
            [XRHandedness.Right]: new XRHandInput(oculusHandConfig, XRHandedness.Right, globalSpace),
        };
        const gaze = supportsGazeTracking(deviceConfig.supportedFeatures)
            ? new XRGazeInput(viewerSpace)
            : undefined;
        const canvasContainer = (_a = deviceOptions.canvasContainer) !== null && _a !== void 0 ? _a : document.createElement('div');
        canvasContainer.dataset.webxr_runtime = `Immersive Web Emulation Runtime v${VERSION}`;
        canvasContainer.style.position = 'fixed';
        canvasContainer.style.width = '100%';
        canvasContainer.style.height = '100%';
        canvasContainer.style.top = '0';
        canvasContainer.style.left = '0';
        canvasContainer.style.display = 'flex';
        canvasContainer.style.justifyContent = 'center';
        canvasContainer.style.alignItems = 'center';
        canvasContainer.style.overflow = 'hidden';
        canvasContainer.style.zIndex = '999';
        const visibilityMask = deviceOptions.visibilityMask === null
            ? undefined
            : ((_b = deviceOptions.visibilityMask) !== null && _b !== void 0 ? _b : deviceConfig.visibilityMask);
        const visibilityMaskCanvas = visibilityMask
            ? document.createElement('canvas')
            : undefined;
        if (visibilityMaskCanvas) {
            visibilityMaskCanvas.dataset.webxrVisibilityMask = deviceConfig.name;
            visibilityMaskCanvas.style.position = 'absolute';
            visibilityMaskCanvas.style.inset = '0';
            visibilityMaskCanvas.style.width = '100%';
            visibilityMaskCanvas.style.height = '100%';
            visibilityMaskCanvas.style.pointerEvents = 'none';
            visibilityMaskCanvas.style.zIndex = Z_INDEX_VISIBILITY_MASK.toString();
        }
        this[P_DEVICE] = {
            name: deviceConfig.name,
            supportedSessionModes: deviceConfig.supportedSessionModes,
            supportedFeatures: deviceConfig.supportedFeatures,
            supportedFrameRates: deviceConfig.supportedFrameRates,
            isSystemKeyboardSupported: deviceConfig.isSystemKeyboardSupported,
            internalNominalFrameRate: deviceConfig.internalNominalFrameRate,
            environmentBlendModes: deviceConfig.environmentBlendModes,
            interactionMode: deviceConfig.interactionMode,
            userAgent: deviceConfig.userAgent,
            position: (_c = deviceOptions.headsetPosition) !== null && _c !== void 0 ? _c : DEFAULTS.headsetPosition.clone(),
            quaternion: (_d = deviceOptions.headsetQuaternion) !== null && _d !== void 0 ? _d : DEFAULTS.headsetQuaternion.clone(),
            stereoEnabled: (_e = deviceOptions.stereoEnabled) !== null && _e !== void 0 ? _e : DEFAULTS.stereoEnabled,
            ipd: (_f = deviceOptions.ipd) !== null && _f !== void 0 ? _f : DEFAULTS.ipd,
            fovy: (_g = deviceOptions.fovy) !== null && _g !== void 0 ? _g : DEFAULTS.fovy,
            visibilityMask,
            visibilityMaskEnabled: Boolean(visibilityMask) &&
                ((_h = deviceOptions.visibilityMaskEnabled) !== null && _h !== void 0 ? _h : true),
            visibilityMaskCanvas,
            controllers,
            hands,
            gaze,
            primaryInputMode: 'controller',
            pendingReferenceSpaceReset: false,
            visibilityState: 'visible',
            pendingVisibilityState: null,
            xrSystem: null,
            installedGlobalObject: null,
            previousNavigatorXRDescriptor: null,
            previousUserAgentDescriptor: null,
            previousGlobals: null,
            previousMakeXRCompatible: null,
            matrix: create$5(),
            globalSpace,
            viewerSpace,
            viewSpaces,
            canvasContainer,
            getViewport: (layer, view) => {
                const canvas = layer.context.canvas;
                const { width, height } = canvas;
                const stereoEnabled = this[P_DEVICE].stereoEnabled;
                const eye = view.eye;
                let x;
                let y;
                let vpWidth;
                let vpHeight;
                switch (eye) {
                    case XREye.None:
                        x = 0;
                        y = 0;
                        vpWidth = width;
                        vpHeight = height;
                        break;
                    case XREye.Left:
                        x = 0;
                        y = 0;
                        vpWidth = stereoEnabled ? width / 2 : width;
                        vpHeight = height;
                        break;
                    case XREye.Right:
                        x = width / 2;
                        y = 0;
                        // zero-width right viewport in mono is deliberate
                        vpWidth = stereoEnabled ? width / 2 : 0;
                        vpHeight = height;
                        break;
                }
                // cache per (eye, width, height, stereoEnabled): return the cached
                // instance unless one of those changed
                const cached = this[P_DEVICE].viewportCache[eye];
                if (cached &&
                    cached.x === x &&
                    cached.y === y &&
                    cached.width === vpWidth &&
                    cached.height === vpHeight) {
                    return cached;
                }
                const viewport = new XRViewport(x, y, vpWidth, vpHeight);
                this[P_DEVICE].viewportCache[eye] = viewport;
                return viewport;
            },
            viewportCache: {},
            updateViews: () => {
                // update viewerSpace
                const viewerSpace = this[P_DEVICE].viewerSpace;
                fromRotationTranslation(viewerSpace[P_SPACE].offsetMatrix, this[P_DEVICE].quaternion.quat, this[P_DEVICE].position.vec3);
                // update viewSpaces
                set$2(leftViewOffsetScratch, -this[P_DEVICE].ipd / 2, 0, 0);
                fromTranslation(this[P_DEVICE].viewSpaces[XREye.Left][P_SPACE].offsetMatrix, leftViewOffsetScratch);
                set$2(rightViewOffsetScratch, this[P_DEVICE].ipd / 2, 0, 0);
                fromTranslation(this[P_DEVICE].viewSpaces[XREye.Right][P_SPACE].offsetMatrix, rightViewOffsetScratch);
            },
            onBaseLayerSet: (baseLayer) => {
                if (!baseLayer)
                    return;
                // backup canvas data
                const canvas = baseLayer.context.canvas;
                if (canvas.parentElement !== this[P_DEVICE].canvasContainer) {
                    const devui = this[P_DEVICE].devui;
                    if (devui) {
                        const { devUICanvas, devUIContainer } = devui;
                        devUICanvas.style.zIndex = Z_INDEX_DEVUI_CANVAS.toString();
                        devUIContainer.style.zIndex = Z_INDEX_DEVUI_CONTAINER.toString();
                        this[P_DEVICE].canvasContainer.appendChild(devui.devUICanvas);
                        this[P_DEVICE].canvasContainer.appendChild(devui.devUIContainer);
                    }
                    const sem = this[P_DEVICE].sem;
                    if (sem) {
                        sem.environmentCanvas.style.zIndex = Z_INDEX_SEM_CANVAS.toString();
                        this[P_DEVICE].canvasContainer.appendChild(sem.environmentCanvas);
                    }
                    this[P_DEVICE].canvasData = {
                        canvas,
                        parent: canvas.parentElement,
                        width: canvas.width,
                        height: canvas.height,
                        zIndex: canvas.style.zIndex,
                    };
                    canvas.style.zIndex = Z_INDEX_APP_CANVAS.toString();
                    this[P_DEVICE].canvasContainer.appendChild(canvas);
                    if (this[P_DEVICE].visibilityMaskCanvas) {
                        this[P_DEVICE].canvasContainer.appendChild(this[P_DEVICE].visibilityMaskCanvas);
                    }
                    document.body.appendChild(this[P_DEVICE].canvasContainer);
                }
                canvas.width = window.innerWidth;
                canvas.height = window.innerHeight;
            },
            onSessionEnd: () => {
                var _a, _b;
                (_b = (_a = this[P_DEVICE].devui) === null || _a === void 0 ? void 0 : _a.onSessionEnd) === null || _b === void 0 ? void 0 : _b.call(_a);
                if (this[P_DEVICE].canvasData) {
                    const { canvas, parent, width, height, zIndex } = this[P_DEVICE].canvasData;
                    canvas.width = width;
                    canvas.height = height;
                    canvas.style.zIndex = zIndex;
                    if (parent) {
                        parent.appendChild(canvas);
                    }
                    else {
                        this[P_DEVICE].canvasContainer.removeChild(canvas);
                    }
                    const devui = this[P_DEVICE].devui;
                    if (devui) {
                        this[P_DEVICE].canvasContainer.removeChild(devui.devUICanvas);
                        this[P_DEVICE].canvasContainer.removeChild(devui.devUIContainer);
                    }
                    const sem = this[P_DEVICE].sem;
                    if (sem) {
                        this[P_DEVICE].canvasContainer.removeChild(sem.environmentCanvas);
                    }
                    const visibilityMaskCanvas = this[P_DEVICE].visibilityMaskCanvas;
                    if ((visibilityMaskCanvas === null || visibilityMaskCanvas === void 0 ? void 0 : visibilityMaskCanvas.parentElement) ===
                        this[P_DEVICE].canvasContainer) {
                        this[P_DEVICE].canvasContainer.removeChild(visibilityMaskCanvas);
                    }
                    document.body.removeChild(this[P_DEVICE].canvasContainer);
                    this[P_DEVICE].canvasData = undefined;
                    window.dispatchEvent(new Event('resize'));
                }
            },
            onFrameStart: (frame) => {
                var _a;
                // Calculate delta time for remote control
                const now = performance.now();
                const deltaTimeMs = this[P_DEVICE].lastFrameTime > 0
                    ? now - this[P_DEVICE].lastFrameTime
                    : 16.67; // Default to ~60fps
                this[P_DEVICE].lastFrameTime = now;
                // Update remote control interface
                if (this[P_DEVICE].remote) {
                    this[P_DEVICE].remote.update(deltaTimeMs);
                }
                if ((_a = this[P_DEVICE].actionPlayer) === null || _a === void 0 ? void 0 : _a.playing) {
                    this[P_DEVICE].actionPlayer.playFrame();
                }
                else {
                    const session = frame.session;
                    if (this[P_DEVICE].pendingVisibilityState) {
                        this[P_DEVICE].visibilityState =
                            this[P_DEVICE].pendingVisibilityState;
                        this[P_DEVICE].pendingVisibilityState = null;
                        session.dispatchEvent(new XRSessionEvent('visibilitychange', { session }));
                    }
                    if (this[P_DEVICE].visibilityState === 'visible') {
                        this.activeInputs.forEach((activeInput) => {
                            activeInput.onFrameStart(frame);
                        });
                    }
                    if (this[P_DEVICE].pendingReferenceSpaceReset) {
                        session[P_SESSION].referenceSpaces.forEach((referenceSpace) => {
                            switch (referenceSpace[P_REF_SPACE].type) {
                                case XRReferenceSpaceType.Local:
                                case XRReferenceSpaceType.LocalFloor:
                                case XRReferenceSpaceType.BoundedFloor:
                                case XRReferenceSpaceType.Unbounded:
                                    referenceSpace.dispatchEvent(new XRReferenceSpaceEvent('reset', { referenceSpace }));
                                    break;
                            }
                        });
                        this[P_DEVICE].pendingReferenceSpaceReset = false;
                    }
                }
                this[P_DEVICE].updateViews();
                this.drawVisibilityMask();
            },
            // control mode for programmatic access
            controlMode: 'manual',
            controlModeListeners: new Set(),
            stateChangeListeners: new Set(),
            // remote control interface - initialized after this object
            remote: null,
            runtime: null,
            // frame timing for remote update
            lastFrameTime: 0,
        };
        // Initialize remote control interface
        this[P_DEVICE].runtime = {
            kind: 'emulated',
            getSession: () => {
                var _a, _b, _c, _d, _e, _f;
                const session = this.activeSession;
                if (!session) {
                    return null;
                }
                // Keep the adapter structural so lightweight XRDevice test doubles and
                // integrations that replace activeSession continue to work.
                const sessionState = session[P_SESSION];
                const structuralSession = session;
                const primaryReferenceSpace = (_a = sessionState === null || sessionState === void 0 ? void 0 : sessionState.referenceSpaces) === null || _a === void 0 ? void 0 : _a[0];
                return {
                    mode: (_c = (_b = sessionState === null || sessionState === void 0 ? void 0 : sessionState.mode) !== null && _b !== void 0 ? _b : structuralSession.mode) !== null && _c !== void 0 ? _c : 'immersive-vr',
                    enabledFeatures: (_d = structuralSession.enabledFeatures) !== null && _d !== void 0 ? _d : [],
                    visibilityState: (_e = structuralSession.visibilityState) !== null && _e !== void 0 ? _e : this.visibilityState,
                    originOffsetMatrix: (_f = primaryReferenceSpace === null || primaryReferenceSpace === void 0 ? void 0 : primaryReferenceSpace[P_SPACE].offsetMatrix) !== null && _f !== void 0 ? _f : null,
                    end: () => { var _a; return (_a = structuralSession.end) === null || _a === void 0 ? void 0 : _a.call(structuralSession); },
                };
            },
        };
        this[P_DEVICE].remote = new RemoteControlInterface(this);
        this[P_DEVICE].updateViews();
    }
    drawVisibilityMask() {
        var _a;
        const mask = this[P_DEVICE].visibilityMask;
        const maskCanvas = this[P_DEVICE].visibilityMaskCanvas;
        const appCanvas = (_a = this[P_DEVICE].canvasData) === null || _a === void 0 ? void 0 : _a.canvas;
        if (!this[P_DEVICE].visibilityMaskEnabled ||
            !mask ||
            !maskCanvas ||
            !appCanvas) {
            return;
        }
        const width = appCanvas.width;
        const height = appCanvas.height;
        if (width <= 0 || height <= 0)
            return;
        if (maskCanvas.width !== width || maskCanvas.height !== height) {
            maskCanvas.width = width;
            maskCanvas.height = height;
        }
        const context = maskCanvas.getContext('2d');
        if (!context)
            return;
        context.clearRect(0, 0, width, height);
        context.fillStyle = '#000';
        const eyes = this[P_DEVICE].stereoEnabled
            ? ['left', 'right']
            : ['left'];
        const eyeWidth = width / eyes.length;
        eyes.forEach((eye, index) => {
            const eyeX = index * eyeWidth;
            const bounds = calculateVisibilityMaskBounds(mask[eye], this[P_DEVICE].fovy, eyeWidth, height);
            context.fillRect(eyeX, 0, eyeWidth, height);
            context.clearRect(eyeX + bounds.x, bounds.y, bounds.width, bounds.height);
        });
    }
    /**
     * Whether a native (non-emulated) WebXR runtime is already present on
     * `navigator.xr`. installRuntime uses this to avoid clobbering a real
     * runtime unless `forceInstall` is set.
     */
    isNativeXRAvailable() {
        var _a;
        const nativeXR = (_a = globalThis.navigator) === null || _a === void 0 ? void 0 : _a.xr;
        // An emulated runtime installed by IWER is an XRSystem instance; anything
        // else present is treated as a native runtime.
        return Boolean(nativeXR) && !(nativeXR instanceof XRSystem);
    }
    installRuntime(options) {
        var _a, _b, _c, _d;
        if (this[P_DEVICE].runtime.kind === 'native') {
            throw new DOMException('Cannot install the emulated runtime while a native override is installed.', 'InvalidStateError');
        }
        const globalObject = ((_a = options === null || options === void 0 ? void 0 : options.globalObject) !== null && _a !== void 0 ? _a : globalThis);
        const polyfillLayers = options === null || options === void 0 ? void 0 : options.polyfillLayers;
        // Skip clobbering a real WebXR runtime unless the caller forces it.
        if (this.isNativeXRAvailable() && !(options === null || options === void 0 ? void 0 : options.forceInstall)) {
            console.warn('IWER: a native WebXR runtime is already available on navigator.xr; ' +
                'skipping installRuntime. Pass { forceInstall: true } to override.');
            return;
        }
        // Track which globals/descriptors we overwrite so uninstallRuntime can
        // best-effort restore them later.
        const previousGlobals = new Map();
        const previousMakeXRCompatible = new Map();
        this[P_DEVICE].installedGlobalObject = globalObject;
        this[P_DEVICE].previousGlobals = previousGlobals;
        this[P_DEVICE].previousMakeXRCompatible = previousMakeXRCompatible;
        const defineMakeXRCompatible = (proto) => {
            if (!proto)
                return;
            previousMakeXRCompatible.set(proto, {
                existed: 'makeXRCompatible' in proto,
                descriptor: Object.getOwnPropertyDescriptor(proto, 'makeXRCompatible'),
            });
            Object.defineProperty(proto, 'makeXRCompatible', {
                value: function () {
                    return new Promise((resolve, _reject) => {
                        resolve(true);
                    });
                },
                configurable: true,
            });
        };
        defineMakeXRCompatible(WebGL2RenderingContext.prototype);
        // Also patch WebGL1 contexts, which can request XR compatibility too.
        defineMakeXRCompatible((_b = globalThis
            .WebGLRenderingContext) === null || _b === void 0 ? void 0 : _b.prototype);
        this[P_DEVICE].xrSystem = new XRSystem(this);
        // Capture the previous navigator.xr / userAgent descriptors before
        // overwriting so uninstallRuntime can restore them.
        this[P_DEVICE].previousNavigatorXRDescriptor =
            (_c = Object.getOwnPropertyDescriptor(globalThis.navigator, 'xr')) !== null && _c !== void 0 ? _c : null;
        this[P_DEVICE].previousUserAgentDescriptor =
            (_d = Object.getOwnPropertyDescriptor(navigator, 'userAgent')) !== null && _d !== void 0 ? _d : null;
        Object.defineProperty(globalThis.navigator, 'xr', {
            value: this[P_DEVICE].xrSystem,
            configurable: true,
        });
        // userAgent is configurable so uninstallRuntime can restore the original.
        Object.defineProperty(navigator, 'userAgent', {
            value: this[P_DEVICE].userAgent,
            writable: false,
            configurable: true,
            enumerable: true,
        });
        const setGlobal = (name, value) => {
            previousGlobals.set(name, {
                existed: name in globalObject,
                value: globalObject[name],
            });
            globalObject[name] = value;
        };
        setGlobal('XRSystem', XRSystem);
        setGlobal('XRSession', XRSession);
        setGlobal('XRRenderState', XRRenderState);
        setGlobal('XRFrame', XRFrame);
        setGlobal('XRSpace', XRSpace);
        setGlobal('XRReferenceSpace', XRReferenceSpace);
        setGlobal('XRJointSpace', XRJointSpace);
        setGlobal('XRView', XRView);
        setGlobal('XRViewport', XRViewport);
        setGlobal('XRRigidTransform', XRRigidTransform);
        setGlobal('XRPose', XRPose);
        setGlobal('XRViewerPose', XRViewerPose);
        setGlobal('XRJointPose', XRJointPose);
        setGlobal('XRInputSource', XRInputSource);
        setGlobal('XRInputSourceArray', XRInputSourceArray);
        setGlobal('XRHand', XRHand);
        setGlobal('XRLayer', XRLayer);
        setGlobal('XRWebGLLayer', XRWebGLLayer);
        setGlobal('XRSessionEvent', XRSessionEvent);
        setGlobal('XRInputSourceEvent', XRInputSourceEvent);
        setGlobal('XRInputSourcesChangeEvent', XRInputSourcesChangeEvent);
        setGlobal('XRReferenceSpaceEvent', XRReferenceSpaceEvent);
        if (polyfillLayers) {
            new WebXRLayersPolyfill();
        }
        else {
            setGlobal('XRMediaBinding', undefined);
        }
        setGlobal('XRWebGLBinding', XRWebGLBinding);
    }
    /**
     * Best-effort reversal of installRuntime: restores the previous
     * navigator.xr / navigator.userAgent descriptors, the WebGL makeXRCompatible
     * methods, and the overwritten global constructors. Safe to call even if
     * installRuntime was never invoked (no-op in that case).
     */
    uninstallRuntime() {
        var _a, _b, _c;
        const previousGlobals = this[P_DEVICE].previousGlobals;
        const globalObject = this[P_DEVICE].installedGlobalObject;
        // Restore overwritten global constructors.
        if (previousGlobals && globalObject) {
            previousGlobals.forEach(({ existed, value }, name) => {
                if (existed) {
                    globalObject[name] = value;
                }
                else {
                    delete globalObject[name];
                }
            });
        }
        // Restore navigator.xr.
        const navXrDescriptor = this[P_DEVICE].previousNavigatorXRDescriptor;
        if (navXrDescriptor) {
            Object.defineProperty(globalThis.navigator, 'xr', navXrDescriptor);
        }
        else if ((_a = Object.getOwnPropertyDescriptor(globalThis.navigator, 'xr')) === null || _a === void 0 ? void 0 : _a.configurable) {
            delete globalThis.navigator.xr;
        }
        // Restore navigator.userAgent (now configurable, so this can succeed).
        const userAgentDescriptor = this[P_DEVICE].previousUserAgentDescriptor;
        if (userAgentDescriptor &&
            ((_b = Object.getOwnPropertyDescriptor(navigator, 'userAgent')) === null || _b === void 0 ? void 0 : _b.configurable)) {
            Object.defineProperty(navigator, 'userAgent', userAgentDescriptor);
        }
        // Restore makeXRCompatible on the WebGL prototypes.
        (_c = this[P_DEVICE].previousMakeXRCompatible) === null || _c === void 0 ? void 0 : _c.forEach(({ existed, descriptor }, proto) => {
            if (existed && descriptor) {
                Object.defineProperty(proto, 'makeXRCompatible', descriptor);
            }
            else {
                delete proto.makeXRCompatible;
            }
        });
        this[P_DEVICE].xrSystem = null;
        this[P_DEVICE].installedGlobalObject = null;
        this[P_DEVICE].previousGlobals = null;
        this[P_DEVICE].previousMakeXRCompatible = null;
        this[P_DEVICE].previousNavigatorXRDescriptor = null;
        this[P_DEVICE].previousUserAgentDescriptor = null;
    }
    installDevUI(devUIConstructor) {
        this[P_DEVICE].devui = new devUIConstructor(this);
    }
    installSEM(semConstructor) {
        this[P_DEVICE].sem = new semConstructor(this);
    }
    get supportedSessionModes() {
        return this[P_DEVICE].supportedSessionModes;
    }
    get supportedFeatures() {
        return this[P_DEVICE].supportedFeatures;
    }
    get supportedFrameRates() {
        return this[P_DEVICE].supportedFrameRates;
    }
    get isSystemKeyboardSupported() {
        return this[P_DEVICE].isSystemKeyboardSupported;
    }
    get internalNominalFrameRate() {
        return this[P_DEVICE].internalNominalFrameRate;
    }
    get stereoEnabled() {
        return this[P_DEVICE].stereoEnabled;
    }
    set stereoEnabled(value) {
        this[P_DEVICE].stereoEnabled = value;
    }
    get ipd() {
        return this[P_DEVICE].ipd;
    }
    set ipd(value) {
        this[P_DEVICE].ipd = value;
    }
    get fovy() {
        return this[P_DEVICE].fovy;
    }
    set fovy(value) {
        this[P_DEVICE].fovy = value;
    }
    get visibilityMask() {
        return this[P_DEVICE].visibilityMask;
    }
    /**
     * Whether this device's configured visibility mask is currently displayed.
     * Profiles without a visibility mask always remain disabled.
     */
    get visibilityMaskEnabled() {
        return this[P_DEVICE].visibilityMaskEnabled;
    }
    set visibilityMaskEnabled(value) {
        const enabled = Boolean(this[P_DEVICE].visibilityMask) && value;
        this[P_DEVICE].visibilityMaskEnabled = enabled;
        if (this[P_DEVICE].visibilityMaskCanvas) {
            this[P_DEVICE].visibilityMaskCanvas.style.display = enabled ? '' : 'none';
        }
    }
    get position() {
        return this[P_DEVICE].position;
    }
    get quaternion() {
        return this[P_DEVICE].quaternion;
    }
    get viewerSpace() {
        var _a;
        if ((_a = this[P_DEVICE].actionPlayer) === null || _a === void 0 ? void 0 : _a.playing) {
            return this[P_DEVICE].actionPlayer.viewerSpace;
        }
        else {
            return this[P_DEVICE].viewerSpace;
        }
    }
    get viewSpaces() {
        var _a;
        if ((_a = this[P_DEVICE].actionPlayer) === null || _a === void 0 ? void 0 : _a.playing) {
            return this[P_DEVICE].actionPlayer.viewSpaces;
        }
        else {
            return this[P_DEVICE].viewSpaces;
        }
    }
    get controllers() {
        return this[P_DEVICE].controllers;
    }
    get hands() {
        return this[P_DEVICE].hands;
    }
    get gaze() {
        return this[P_DEVICE].gaze;
    }
    get primaryInputMode() {
        return this[P_DEVICE].primaryInputMode;
    }
    set primaryInputMode(mode) {
        if (mode !== 'controller' && mode !== 'hand') {
            console.warn('primary input mode can only be "controller" or "hand"');
            return;
        }
        this[P_DEVICE].primaryInputMode = mode;
    }
    get activeInputs() {
        if (this[P_DEVICE].visibilityState !== 'visible') {
            return [];
        }
        const primaryInputs = this[P_DEVICE].primaryInputMode === 'controller'
            ? Object.values(this[P_DEVICE].controllers)
            : Object.values(this[P_DEVICE].hands);
        const activeInputs = this[P_DEVICE].gaze
            ? [...primaryInputs, this[P_DEVICE].gaze]
            : primaryInputs;
        return activeInputs.filter((input) => input.connected);
    }
    get inputSources() {
        var _a;
        if ((_a = this[P_DEVICE].actionPlayer) === null || _a === void 0 ? void 0 : _a.playing) {
            return this[P_DEVICE].actionPlayer.inputSources;
        }
        else {
            return this.activeInputs.map((input) => input.inputSource);
        }
    }
    get canvasContainer() {
        return this[P_DEVICE].canvasContainer;
    }
    get canvasDimensions() {
        if (this[P_DEVICE].canvasData) {
            const { width, height } = this[P_DEVICE].canvasData.canvas;
            return { width, height };
        }
        return;
    }
    /**
     * Get the app canvas when an XR session is active.
     * Returns undefined if no session is active or no canvas is available.
     */
    get appCanvas() {
        var _a;
        return (_a = this[P_DEVICE].canvasData) === null || _a === void 0 ? void 0 : _a.canvas;
    }
    get activeSession() {
        var _a;
        return (_a = this[P_DEVICE].xrSystem) === null || _a === void 0 ? void 0 : _a[P_SYSTEM].activeSession;
    }
    get sessionOffered() {
        var _a;
        return Boolean((_a = this[P_DEVICE].xrSystem) === null || _a === void 0 ? void 0 : _a[P_SYSTEM].offeredSessionConfig);
    }
    get name() {
        return this[P_DEVICE].name;
    }
    grantOfferedSession() {
        const xrSystem = this[P_DEVICE].xrSystem;
        const pSystem = xrSystem === null || xrSystem === void 0 ? void 0 : xrSystem[P_SYSTEM];
        if (pSystem && pSystem.offeredSessionConfig) {
            const { resolve, reject, mode, options } = pSystem.offeredSessionConfig;
            // Clear the offered session config first
            pSystem.offeredSessionConfig = undefined;
            // Use the same requestSession flow to ensure identical behavior
            xrSystem.requestSession(mode, options).then(resolve).catch(reject);
        }
    }
    recenter() {
        const deltaVec = new Vector3(-this.position.x, 0, -this.position.z);
        const forward = new Vector3(0, 0, -1).applyQuaternion(this.quaternion);
        forward.y = 0;
        forward.normalize();
        const angle = Math.atan2(forward.x, -forward.z);
        const deltaQuat = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), angle);
        this.position.add(deltaVec);
        this.quaternion.multiply(deltaQuat);
        [
            ...Object.values(this[P_DEVICE].controllers),
            ...Object.values(this[P_DEVICE].hands),
        ].forEach((activeInput) => {
            activeInput.position.add(deltaVec);
            activeInput.quaternion.multiply(deltaQuat);
            activeInput.position.applyQuaternion(deltaQuat);
        });
        this[P_DEVICE].pendingReferenceSpaceReset = true;
    }
    get visibilityState() {
        return this[P_DEVICE].visibilityState;
    }
    // visibility state updates are queued until the XRSession produces frames
    updateVisibilityState(state) {
        if (!Object.values(['visible', 'visible-blurred', 'hidden']).includes(state)) {
            throw new DOMException('Invalid XRVisibilityState value', 'NotSupportedError');
        }
        if (state !== this[P_DEVICE].visibilityState) {
            this[P_DEVICE].pendingVisibilityState = state;
        }
    }
    createActionPlayer(refSpace, recording, options = {}) {
        var _a, _b;
        const player = new ActionPlayer(refSpace, recording, this[P_DEVICE].ipd, options);
        this[P_DEVICE].actionPlayer = player;
        (_b = (_a = this[P_DEVICE].runtime).onActionPlayerCreated) === null || _b === void 0 ? void 0 : _b.call(_a, player);
        return player;
    }
    get devui() {
        return this[P_DEVICE].devui;
    }
    get sem() {
        return this[P_DEVICE].sem;
    }
    get remote() {
        return this[P_DEVICE].remote;
    }
    // =============================================================================
    // Control Mode API
    // =============================================================================
    /**
     * Get the current control mode
     * - 'manual': User controls device via DevUI (default)
     * - 'programmatic': External API controls device
     */
    get controlMode() {
        return this[P_DEVICE].controlMode;
    }
    /**
     * Set the control mode
     * Notifies all registered listeners of the change
     */
    set controlMode(mode) {
        if (mode !== 'manual' && mode !== 'programmatic') {
            console.warn('control mode can only be "manual" or "programmatic"');
            return;
        }
        const prevMode = this[P_DEVICE].controlMode;
        if (prevMode !== mode) {
            this[P_DEVICE].controlMode = mode;
            this[P_DEVICE].controlModeListeners.forEach((listener) => listener(mode));
        }
    }
    /**
     * Register a listener to be notified when control mode changes
     * @param listener - Callback function that receives the new mode
     * @returns Unsubscribe function to remove the listener
     */
    onControlModeChange(listener) {
        this[P_DEVICE].controlModeListeners.add(listener);
        return () => {
            this[P_DEVICE].controlModeListeners.delete(listener);
        };
    }
    /**
     * Register a listener to be notified when device state changes
     * Called after programmatic state modifications
     * @param listener - Callback function
     * @returns Unsubscribe function to remove the listener
     */
    onStateChange(listener) {
        this[P_DEVICE].stateChangeListeners.add(listener);
        return () => {
            this[P_DEVICE].stateChangeListeners.delete(listener);
        };
    }
    /**
     * Notify all state change listeners that device state has been modified
     * Should be called after programmatic state modifications
     */
    notifyStateChange() {
        this[P_DEVICE].stateChangeListeners.forEach((listener) => listener());
    }
}

/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
// value pulled from https://felixtrz.github.io/webxr-device-config/
// on Oculus Quest 1, Meta Quest 2, Meta Quest Pro, Meta Quest 3
const gamepadConfigLeft = {
    mapping: GamepadMappingType.XRStandard,
    buttons: [
        { id: 'trigger', type: 'analog', eventTrigger: 'select' },
        { id: 'squeeze', type: 'analog', eventTrigger: 'squeeze' },
        null,
        { id: 'thumbstick', type: 'binary' },
        { id: 'x-button', type: 'binary' },
        { id: 'y-button', type: 'binary' },
        { id: 'thumbrest', type: 'binary' },
    ],
    axes: [
        null,
        null,
        { id: 'thumbstick', type: 'x-axis' },
        { id: 'thumbstick', type: 'y-axis' },
    ],
};
const gamepadConfigRight = {
    mapping: GamepadMappingType.XRStandard,
    buttons: [
        { id: 'trigger', type: 'analog', eventTrigger: 'select' },
        { id: 'squeeze', type: 'analog', eventTrigger: 'squeeze' },
        null,
        { id: 'thumbstick', type: 'binary' },
        { id: 'a-button', type: 'binary' },
        { id: 'b-button', type: 'binary' },
        { id: 'thumbrest', type: 'binary' },
    ],
    axes: [
        null,
        null,
        { id: 'thumbstick', type: 'x-axis' },
        { id: 'thumbstick', type: 'y-axis' },
    ],
};
const oculusTouchV2 = {
    profileId: 'oculus-touch-v2',
    fallbackProfileIds: ['oculus-touch', 'generic-trigger-squeeze-thumbstick'],
    layout: {
        left: {
            gamepad: gamepadConfigLeft,
            gripOffsetMatrix: [
                0.9925461411476135, 4.673031295254759e-9, -0.12186938524246216, 0,
                0.08617470413446426, 0.7071065306663513, 0.7018362283706665, 0,
                0.0861746296286583, -0.70710688829422, 0.7018358707427979, 0,
                -0.003979847766458988, -0.01585787907242775, 0.04964185878634453, 1,
            ],
            numHapticActuators: 1,
        },
        right: {
            gamepad: gamepadConfigRight,
            gripOffsetMatrix: [
                0.9925461411476135, 3.688163374704345e-8, 0.12186937034130096, 0,
                -0.08617469668388367, 0.7071066498756409, 0.7018361687660217, 0,
                -0.0861746147274971, -0.7071068286895752, 0.7018359899520874, 0,
                0.003979853354394436, -0.01585787907242775, 0.04964182525873184, 1,
            ],
            numHapticActuators: 1,
        },
    },
};
const oculusTouchV3 = {
    profileId: 'oculus-touch-v3',
    fallbackProfileIds: ['oculus-touch', 'generic-trigger-squeeze-thumbstick'],
    layout: {
        left: {
            gamepad: gamepadConfigLeft,
            gripOffsetMatrix: [
                0.9925461411476135, 2.0823669899527886e-8, -0.12186937034130096, 0,
                0.08617465198040009, 0.7071067094802856, 0.701836109161377, 0,
                0.08617466688156128, -0.7071067690849304, 0.7018360495567322, 0,
                -0.003979838453233242, -0.015857907012104988, 0.04964181408286095, 1,
            ],
            numHapticActuators: 1,
        },
        right: {
            gamepad: gamepadConfigRight,
            gripOffsetMatrix: [
                0.9925461411476135, -8.329467959811154e-8, 0.12186941504478455, 0,
                -0.08617465943098068, 0.7071066498756409, 0.7018361687660217, 0,
                -0.08617471158504486, -0.7071068286895752, 0.7018359303474426, 0,
                0.003979798872023821, -0.015857888385653496, 0.049641866236925125, 1,
            ],
            numHapticActuators: 1,
        },
    },
};
const metaQuestTouchPro = {
    profileId: 'meta-quest-touch-pro',
    fallbackProfileIds: [
        'oculus-touch-v2',
        'oculus-touch',
        'generic-trigger-squeeze-thumbstick',
    ],
    layout: {
        left: {
            gamepad: gamepadConfigLeft,
            gripOffsetMatrix: [
                0.9925461411476135, -1.5779937356796836e-8, -0.12186935544013977, 0,
                0.08617467433214188, 0.7071067094802856, 0.701836109161377, 0,
                0.0861746296286583, -0.7071067690849304, 0.7018360495567322, 0,
                -0.003979836590588093, -0.015857847407460213, 0.049641840159893036, 1,
            ],
            numHapticActuators: 3,
        },
        right: {
            gamepad: gamepadConfigRight,
            gripOffsetMatrix: [
                0.9925461411476135, 9.267653311439972e-11, 0.12186937034130096, 0,
                -0.08617467433214188, 0.7071067094802856, 0.7018361687660217, 0,
                -0.08617464452981949, -0.7071067690849304, 0.7018360495567322, 0,
                0.003979847766458988, -0.01585782691836357, 0.04964186251163483, 1,
            ],
            numHapticActuators: 3,
        },
    },
};
const metaQuestTouchPlus = {
    profileId: 'meta-quest-touch-plus',
    fallbackProfileIds: [
        'oculus-touch-v3',
        'oculus-touch',
        'generic-trigger-squeeze-thumbstick',
    ],
    layout: {
        left: {
            gamepad: gamepadConfigLeft,
            gripOffsetMatrix: [
                0.9925461411476135, 1.0736208366779465e-8, -0.12186933308839798, 0,
                0.08617459982633591, 0.70710688829422, 0.7018360495567322, 0,
                0.08617466688156128, -0.7071067094802856, 0.7018362283706665, 0,
                -0.003979803062975407, -0.015857873484492302, 0.04964187368750572, 1,
            ],
            numHapticActuators: 1,
        },
        right: {
            gamepad: gamepadConfigRight,
            gripOffsetMatrix: [
                0.9925461411476135, -2.6238110351073374e-8, 0.12186934053897858, 0,
                -0.0861746147274971, 0.7071067690849304, 0.7018360495567322, 0,
                -0.08617465943098068, -0.7071067094802856, 0.701836109161377, 0,
                0.003979838453233242, -0.015857869759202003, 0.04964182525873184, 1,
            ],
            numHapticActuators: 1,
        },
    },
};

/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
const degrees = (value) => (value * Math.PI) / 180;
/**
 * Angular bounds sampled from Meta VR Glasses XRView projection matrices. The same
 * projection was reported for both eyes in immersive-vr and immersive-ar.
 */
const metaVRGlassesVisibilityMask = {
    left: {
        angleLeft: degrees(37),
        angleRight: degrees(37),
        angleUp: degrees(25),
        angleDown: degrees(43),
    },
    right: {
        angleLeft: degrees(37),
        angleRight: degrees(37),
        angleUp: degrees(25),
        angleDown: degrees(43),
    },
};
const oculusQuest1 = {
    name: 'Oculus Quest 1',
    controllerConfig: oculusTouchV2,
    supportedSessionModes: ['inline', 'immersive-vr', 'immersive-ar'],
    supportedFeatures: [
        'viewer',
        'local',
        'local-floor',
        'bounded-floor',
        'unbounded',
        'anchors',
        'plane-detection',
        'hand-tracking',
    ],
    supportedFrameRates: [72, 80, 90],
    isSystemKeyboardSupported: true,
    internalNominalFrameRate: 72,
    environmentBlendModes: {
        ['immersive-vr']: XREnvironmentBlendMode.Opaque,
        ['immersive-ar']: XREnvironmentBlendMode.AlphaBlend,
    },
    interactionMode: XRInteractionMode.WorldSpace,
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64; Quest 1) AppleWebKit/537.36 (KHTML, like Gecko) OculusBrowser/33.0.0.x.x.x Chrome/126.0.6478.122 VR Safari/537.36',
};
const metaQuest2 = {
    name: 'Meta Quest 2',
    controllerConfig: oculusTouchV3,
    supportedSessionModes: ['inline', 'immersive-vr', 'immersive-ar'],
    supportedFeatures: [
        'viewer',
        'local',
        'local-floor',
        'bounded-floor',
        'unbounded',
        'anchors',
        'plane-detection',
        'mesh-detection',
        'hit-test',
        'hand-tracking',
    ],
    supportedFrameRates: [72, 80, 90, 120],
    isSystemKeyboardSupported: true,
    internalNominalFrameRate: 72,
    environmentBlendModes: {
        ['immersive-vr']: XREnvironmentBlendMode.Opaque,
        ['immersive-ar']: XREnvironmentBlendMode.AlphaBlend,
    },
    interactionMode: XRInteractionMode.WorldSpace,
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64; Quest 2) AppleWebKit/537.36 (KHTML, like Gecko) OculusBrowser/33.0.0.x.x.x Chrome/126.0.6478.122 VR Safari/537.36',
};
const metaQuestPro = {
    name: 'Meta Quest Pro',
    controllerConfig: metaQuestTouchPro,
    supportedSessionModes: ['inline', 'immersive-vr', 'immersive-ar'],
    supportedFeatures: [
        'viewer',
        'local',
        'local-floor',
        'bounded-floor',
        'unbounded',
        'anchors',
        'plane-detection',
        'mesh-detection',
        'hit-test',
        'hand-tracking',
        'gaze-tracking',
        'eye-tracking',
    ],
    supportedFrameRates: [72, 80, 90, 120],
    isSystemKeyboardSupported: true,
    internalNominalFrameRate: 90,
    environmentBlendModes: {
        ['immersive-vr']: XREnvironmentBlendMode.Opaque,
        ['immersive-ar']: XREnvironmentBlendMode.AlphaBlend,
    },
    interactionMode: XRInteractionMode.WorldSpace,
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64; Quest Pro) AppleWebKit/537.36 (KHTML, like Gecko) OculusBrowser/33.0.0.x.x.x Chrome/126.0.6478.122 VR Safari/537.36',
};
const metaQuest3 = {
    name: 'Meta Quest 3',
    controllerConfig: metaQuestTouchPlus,
    supportedSessionModes: ['inline', 'immersive-vr', 'immersive-ar'],
    supportedFeatures: [
        'viewer',
        'local',
        'local-floor',
        'bounded-floor',
        'unbounded',
        'anchors',
        'plane-detection',
        'mesh-detection',
        'hit-test',
        'hand-tracking',
        'depth-sensing',
    ],
    supportedFrameRates: [72, 80, 90, 120],
    isSystemKeyboardSupported: true,
    internalNominalFrameRate: 90,
    environmentBlendModes: {
        ['immersive-vr']: XREnvironmentBlendMode.Opaque,
        ['immersive-ar']: XREnvironmentBlendMode.AlphaBlend,
    },
    interactionMode: XRInteractionMode.WorldSpace,
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64; Quest 3) AppleWebKit/537.36 (KHTML, like Gecko) OculusBrowser/33.0.0.x.x.x Chrome/126.0.6478.122 VR Safari/537.36',
};
/** Quest-compatible input/runtime profile with Meta VR Glasses' narrower view mask. */
const metaVRGlasses = {
    ...metaQuest3,
    name: 'Meta VR Glasses',
    supportedFrameRates: [72, 90, 96, 100, 120],
    visibilityMask: metaVRGlassesVisibilityMask,
};

/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
// Generic controller config used as the universal fallback profile. The
// profile id 'generic-trigger-squeeze-thumbstick' is referenced as a
// fallbackProfileId by every meta controller config but was never defined as
// an authorable config. This mirrors the meta Touch xr-standard layout
// (trigger/squeeze/thumbstick) so consumers always have a concrete config for
// the generic profile.
const gamepadConfig = {
    mapping: GamepadMappingType.XRStandard,
    buttons: [
        { id: 'trigger', type: 'analog', eventTrigger: 'select' },
        { id: 'squeeze', type: 'analog', eventTrigger: 'squeeze' },
        null,
        { id: 'thumbstick', type: 'binary' },
    ],
    axes: [
        null,
        null,
        { id: 'thumbstick', type: 'x-axis' },
        { id: 'thumbstick', type: 'y-axis' },
    ],
};
const generic = {
    profileId: 'generic-trigger-squeeze-thumbstick',
    fallbackProfileIds: [],
    layout: {
        left: {
            gamepad: gamepadConfig,
            numHapticActuators: 1,
        },
        right: {
            gamepad: gamepadConfig,
            numHapticActuators: 1,
        },
        none: {
            gamepad: gamepadConfig,
            numHapticActuators: 1,
        },
    },
};

/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
/**
 * Tracks property overrides and restores them in reverse order.
 *
 * A failed patch is never recorded, so callers can safely try an instance
 * first and then fall back to its prototype.
 */
class PatchRegistry {
    constructor() {
        this.entries = [];
    }
    get size() {
        return this.entries.length;
    }
    define(target, key, descriptor) {
        const previous = Object.getOwnPropertyDescriptor(target, key);
        try {
            Object.defineProperty(target, key, descriptor);
            this.entries.push({ target, key, descriptor: previous });
            return true;
        }
        catch (_a) {
            return false;
        }
    }
    revert() {
        for (let index = this.entries.length - 1; index >= 0; index--) {
            const { target, key, descriptor } = this.entries[index];
            try {
                if (descriptor) {
                    Object.defineProperty(target, key, descriptor);
                }
                else {
                    Reflect.deleteProperty(target, key);
                }
            }
            catch (_a) {
                // Restoration is best-effort for host objects. Callers should expose a
                // capability failure rather than mask the original application error.
            }
        }
        this.entries = [];
    }
}

/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
function clearedCapabilities() {
    return {
        requestSession: false,
        offerSession: false,
        inputSources: false,
        inputEvents: false,
        brandedInputEvents: false,
        enabledFeatures: false,
        viewerSpaceTagging: false,
        poseOverride: false,
        batchPoses: false,
        viewerPose: false,
        viewTransforms: false,
        handInput: false,
        jointPoses: false,
        actionPlayback: false,
        anchors: false,
        hitTest: false,
    };
}
const NATIVE_OVERRIDE_KEY = Symbol.for('@iwer/native-override');
const INPUT_EVENT_NAMES = [
    'select',
    'selectstart',
    'selectend',
    'squeeze',
    'squeezestart',
    'squeezeend',
];
const HAND_TRACKING_FEATURE = 'hand-tracking';
/** Upper bound on the exponential backoff between failed subscription swaps. */
const MAX_HIT_TEST_BACKOFF_FRAMES = 32;
/**
 * Motion a hit test subscription tolerates before it is resubscribed. Real
 * tracking jitter is far above float epsilon, so an exact comparison would
 * resubscribe on every frame and never settle.
 */
const HIT_TEST_TRANSLATION_TOLERANCE_M = 0.005;
const HIT_TEST_ROTATION_TOLERANCE_RAD = Math.PI / 180;
/**
 * Soft bound for queued input events. Only complete queued action lifecycles
 * are discarded, so backpressure can never manufacture an orphaned start/end.
 */
const MAX_PENDING_EVENTS = 256;
/** Persistent frame failures mean the installed override is no longer healthy. */
const FRAME_PREPARATION_FAILURE_THRESHOLD = 3;
/** Emit one final bounded diagnostic for a failure that remains persistent. */
const FRAME_PREPARATION_FINAL_DIAGNOSTIC_COUNT = 60;
const scratchViewerMatrix = create$5();
const scratchTargetMatrix = create$5();
const scratchAnchorToBase = create$5();
const scratchBaseToAnchor = create$5();
const scratchRelativeView = create$5();
const scratchResultMatrix = create$5();
const scratchControlledMatrix = create$5();
const scratchHitTestMatrix = create$5();
const scratchPosition = create$4();
const scratchOrientation = create$2();
const scratchRadius = new Float32Array(1);
function findPropertyOwner(target, key) {
    let current = target;
    while (current) {
        if (Object.prototype.hasOwnProperty.call(current, key)) {
            return current;
        }
        current = Object.getPrototypeOf(current);
    }
    return null;
}
function installedOverride(xr) {
    try {
        const direct = Reflect.get(xr, NATIVE_OVERRIDE_KEY);
        const requestSession = Reflect.get(xr, 'requestSession');
        const candidate = direct !== null && direct !== void 0 ? direct : (typeof requestSession === 'function'
            ? Reflect.get(requestSession, NATIVE_OVERRIDE_KEY)
            : null);
        if (candidate !== null &&
            typeof candidate === 'object' &&
            typeof candidate.installed === 'boolean' &&
            typeof candidate.uninstall === 'function') {
            return candidate;
        }
    }
    catch (_a) {
        // Ignore hostile or cross-realm host-object accessors.
    }
    return null;
}
function methodDescriptor(target, key) {
    const owner = findPropertyOwner(target, key);
    const descriptor = owner
        ? Object.getOwnPropertyDescriptor(owner, key)
        : undefined;
    return owner && descriptor ? { owner, descriptor } : null;
}
function matrixFromTransform(transform) {
    const output = create$5();
    for (let index = 0; index < 16; index++) {
        output[index] = transform.matrix[index];
    }
    return output;
}
function copyMatrixToArray(matrix, output, offset) {
    for (let index = 0; index < 16; index++) {
        output[offset + index] = matrix[index];
    }
}
const toleranceLeftPosition = create$4();
const toleranceRightPosition = create$4();
const toleranceLeftRotation = create$2();
const toleranceRightRotation = create$2();
/**
 * Reports whether two anchor-relative poses are close enough that resubscribing
 * a native hit test source would be wasted work.
 */
function poseWithinTolerance(left, right) {
    getTranslation(toleranceLeftPosition, left);
    getTranslation(toleranceRightPosition, right);
    if (squaredDistance(toleranceLeftPosition, toleranceRightPosition) >
        HIT_TEST_TRANSLATION_TOLERANCE_M * HIT_TEST_TRANSLATION_TOLERANCE_M) {
        return false;
    }
    getRotation(toleranceLeftRotation, left);
    getRotation(toleranceRightRotation, right);
    // |dot| maps to cos(theta/2); compare against the half-angle tolerance.
    const dot$1 = Math.abs(dot(toleranceLeftRotation, toleranceRightRotation));
    return Math.min(dot$1, 1) >= Math.cos(HIT_TEST_ROTATION_TOLERANCE_RAD / 2);
}
/**
 * WebXR Hand Input treats an absent or non-positive radius as "not tracked":
 * fillJointRadii reports NaN and getJointPose reports a null pose.
 */
function isTrackedRadius(radius) {
    return Number.isFinite(radius) && radius > 0;
}
function invalidState(message) {
    return new DOMException(message, 'InvalidStateError');
}
function notSupported(message) {
    return new DOMException(message, 'NotSupportedError');
}
function isImmersiveMode(mode) {
    return mode === 'immersive-vr' || mode === 'immersive-ar';
}
function propertyCanBePatched(target, key) {
    const ownDescriptor = Object.getOwnPropertyDescriptor(target, key);
    if (ownDescriptor) {
        return ownDescriptor.configurable || ownDescriptor.writable === true;
    }
    if (Object.isExtensible(target)) {
        return true;
    }
    const inherited = methodDescriptor(Object.getPrototypeOf(target), key);
    return Boolean(inherited &&
        (inherited.descriptor.configurable ||
            inherited.descriptor.writable === true));
}
function globalRecord(globalObject) {
    return globalObject;
}
function eventConstructor(globalObject) {
    const candidate = globalRecord(globalObject).Event;
    return typeof candidate === 'function'
        ? candidate
        : undefined;
}
function resolveXRSystem(environment) {
    var _a, _b, _c;
    const globalObject = (_a = environment.globalObject) !== null && _a !== void 0 ? _a : globalThis;
    return ((_b = environment.xrSystem) !== null && _b !== void 0 ? _b : (_c = globalRecord(globalObject).navigator) === null || _c === void 0 ? void 0 : _c.xr);
}
/**
 * Reports whether the minimum native hooks required by XRNativeOverride appear
 * to be available. Host-object patching can still fail at runtime, so install()
 * records the authoritative result in its capabilities object.
 */
function getNativeOverrideSupport(environment = {}) {
    var _a;
    const globalObject = (_a = environment.globalObject) !== null && _a !== void 0 ? _a : globalThis;
    const xr = resolveXRSystem(environment);
    const notes = [];
    const requestSession = Boolean(xr &&
        typeof xr.requestSession === 'function' &&
        propertyCanBePatched(xr, 'requestSession'));
    if (!xr) {
        notes.push('navigator.xr is unavailable.');
    }
    else if (!requestSession) {
        notes.push('The native XRSystem.requestSession method cannot be patched.');
    }
    if (typeof globalRecord(globalObject).XRRigidTransform !== 'function') {
        notes.push('The native XRRigidTransform constructor is unavailable.');
    }
    return {
        supported: requestSession &&
            typeof globalRecord(globalObject).XRRigidTransform === 'function',
        requestSession,
        notes,
    };
}
/**
 * Returns the installed override without relying on instanceof, so callers
 * can recover a handle installed by another IWER bundle or a prior HMR pass.
 */
function getNativeOverride(environment = {}) {
    const xr = resolveXRSystem(environment);
    return xr ? installedOverride(xr) : null;
}
/**
 * Selectively overrides native WebXR tracking and input while preserving the
 * browser-owned XRSession, compositor, layers, frame cadence, and projections.
 *
 * Prefer installNativeOverride() for installation; direct construction is the
 * low-level path when installation must be deferred or retried.
 */
class XRNativeOverride {
    constructor(device, options = {}) {
        var _a, _b, _c;
        this.patches = new PatchRegistry();
        this.sessionsByObject = new WeakMap();
        this.liveSessions = new Set();
        this.frameSessions = new WeakMap();
        this.spaces = new WeakMap();
        this.hitTestBindings = new WeakMap();
        this.syntheticEvents = new WeakSet();
        this.patchedFrameOwners = new WeakSet();
        this.patchedViewerFrameOwners = new WeakSet();
        this.patchedFillPosesOwners = new WeakSet();
        this.patchedJointPoseOwners = new WeakSet();
        this.patchedJointRadiiOwners = new WeakSet();
        this.patchedReferenceSpaceOwners = new WeakSet();
        this.patchedEnabledFeaturesOwners = new WeakSet();
        this.patchedInputSourceOwners = new WeakSet();
        this.patchedRafOwners = new WeakSet();
        this.patchedRequestReferenceSpaceOwners = new WeakSet();
        this.patchedHitTestOwners = new WeakSet();
        this.patchedHitTestResultOwners = new WeakSet();
        this.patchedCreateAnchorOwners = new WeakSet();
        this.instancePatchedReferenceSpaces = new WeakSet();
        this.rawGetPoseByOwner = new WeakMap();
        this.rawGetPoseByFrame = new WeakMap();
        this.rawRafByOwner = new WeakMap();
        this.rawRequestReferenceSpaceByOwner = new WeakMap();
        this.rawInputSourcesGetterByOwner = new WeakMap();
        this.rawTransformGetters = new WeakMap();
        this.transformReaders = new WeakMap();
        this.transformOverrides = new WeakMap();
        this.patchedTransformOwners = new WeakSet();
        this.instancePatchedFrameEpochs = new WeakMap();
        this.instancePatchedTransformEpochs = new WeakMap();
        this.warned = new Set();
        this.unhealthyFrameAdapters = new Set();
        this.installedState = false;
        this.primarySession = null;
        this.previousRuntime = null;
        this.epoch = 0;
        this.wiredPlayer = null;
        /**
         * Set while a native frame samples a recording. It keeps the final sampled
         * frame observable to the application even though ActionPlayer.playFrame()
         * clears `playing` as it clamps to the end of the recording.
         */
        this.playbackFrame = null;
        /**
         * Handed to ActionPlayer when no session owns an active frame, so an
         * application-driven stepFrames()/playFrame() still runs the player's edge
         * detection. The override re-stamps every relayed event with a real frame
         * when it drains, so this token never reaches the application.
         */
        this.detachedPlaybackFrame = {};
        this.device = device;
        this.mode = (_a = options.mode) !== null && _a !== void 0 ? _a : 'full';
        this.options = {
            ...options,
            mode: this.mode,
            onUnsupported: (_b = options.onUnsupported) !== null && _b !== void 0 ? _b : 'warn',
        };
        this.globalObject = (_c = options.globalObject) !== null && _c !== void 0 ? _c : globalThis;
        this.xrSystem = resolveXRSystem(options);
        const support = getNativeOverrideSupport({
            xrSystem: this.xrSystem,
            globalObject: this.globalObject,
        });
        this.capabilityState = {
            phase: 'uninstalled',
            supported: support.supported,
            ...clearedCapabilities(),
            notes: [...support.notes],
        };
    }
    get installed() {
        return this.installedState;
    }
    get capabilities() {
        return {
            ...this.capabilityState,
            notes: [...this.capabilityState.notes],
        };
    }
    get sessions() {
        return Array.from(this.liveSessions, (adapter) => ({
            session: adapter.session,
            mode: adapter.mode,
            primary: adapter === this.primarySession,
            anchorSpace: adapter.anchorSpace,
        }));
    }
    install() {
        if (this.installedState) {
            return;
        }
        const xr = resolveXRSystem(this.options);
        this.xrSystem = xr;
        const support = getNativeOverrideSupport({
            xrSystem: xr,
            globalObject: this.globalObject,
        });
        Object.assign(this.capabilityState, {
            phase: 'uninstalled',
            supported: support.supported,
            ...clearedCapabilities(),
            notes: [],
        });
        this.warned.clear();
        if (!xr || !support.supported) {
            const notes = support.notes.length > 0
                ? support.notes
                : ['Native WebXR override prerequisites are unavailable.'];
            this.capabilityState.supported = false;
            for (const note of notes) {
                this.note(note);
            }
            if (this.options.onUnsupported === 'throw') {
                throw new Error(notes.join(' '));
            }
            return;
        }
        if (this.device[P_DEVICE].installedGlobalObject) {
            throw invalidState('Cannot install a native override while the emulated IWER runtime is installed.');
        }
        // Only a structurally valid IWER handle claims the shared marker; malformed
        // or colliding values are ignored rather than permanently wedging install.
        const existing = installedOverride(xr);
        if (existing && existing !== this) {
            throw invalidState('A native IWER override is already installed on this XRSystem.');
        }
        const override = this;
        const wrapSessionMethod = (nativeSessionMethod) => {
            const wrappedSessionMethod = async function (mode, options) {
                if (this !== xr || !isImmersiveMode(mode)) {
                    return nativeSessionMethod.call(this, mode, options);
                }
                // The gaze aliases are owned by IWER, so they are answered here rather
                // than by the browser and never reach the native request or offer.
                const request = override.prepareSessionRequest(options);
                const session = await nativeSessionMethod.call(this, mode, request.options);
                if (override.options.mode === 'gaze-only' &&
                    request.gaze.enabled.length === 0) {
                    return session;
                }
                try {
                    await override.attachSession(session, mode, request.gaze.enabled);
                }
                catch (error) {
                    override.detachSession(session);
                    // A required alias that cannot be satisfied is a failed request, not
                    // a degradation. An accepted optional alias is the opposite: WebXR
                    // requires the session to survive it, which outranks the "throw"
                    // unsupported policy. An alias rejected by the selected profile
                    // never participates and cannot mask an unrelated strict attachment
                    // error.
                    const failsRequest = request.gaze.required.length > 0 ||
                        (request.gaze.enabled.length === 0 &&
                            override.options.onUnsupported === 'throw');
                    if (failsRequest) {
                        await session.end().catch(() => { });
                        if (request.gaze.required.length > 0 &&
                            (!(error instanceof DOMException) ||
                                error.name !== 'NotSupportedError')) {
                            throw notSupported(override.errorText(error));
                        }
                        throw error;
                    }
                    override.note(`Native session override was skipped: ${override.errorText(error)}`, 'session-attach-failed');
                }
                return session;
            };
            // The registered symbol makes the guard visible across independently
            // bundled copies of IWER. Mark each wrapper as well as the host object so
            // the guard still works when an XRSystem refuses new own properties.
            Object.defineProperty(wrappedSessionMethod, NATIVE_OVERRIDE_KEY, {
                value: this,
            });
            return wrappedSessionMethod;
        };
        const patchSessionMethod = (key, wrappedSessionMethod) => {
            let patched = this.patches.define(xr, key, {
                configurable: true,
                writable: true,
                value: wrappedSessionMethod,
            });
            if (!patched) {
                const found = methodDescriptor(xr, key);
                if (found && typeof found.descriptor.value === 'function') {
                    const descriptor = found.descriptor;
                    patched = this.patches.define(found.owner, key, {
                        ...descriptor,
                        value: wrappedSessionMethod,
                    });
                }
            }
            return patched;
        };
        const nativeRequestSession = xr.requestSession;
        if (!patchSessionMethod('requestSession', wrapSessionMethod(nativeRequestSession))) {
            this.unsupported('Unable to patch native XRSystem.requestSession.');
            return;
        }
        const nativeOfferSession = Reflect.get(xr, 'offerSession');
        if (typeof nativeOfferSession === 'function') {
            if (patchSessionMethod('offerSession', wrapSessionMethod(nativeOfferSession))) {
                this.capabilityState.offerSession = true;
            }
            else {
                this.note('The native XRSystem.offerSession method could not be patched; sessions created through it are not overridden.');
            }
        }
        this.patches.define(xr, NATIVE_OVERRIDE_KEY, {
            configurable: true,
            value: this,
        });
        this.previousRuntime = this.device[P_DEVICE].runtime;
        this.device[P_DEVICE].runtime = {
            kind: 'native',
            getSession: () => {
                const adapter = this.primarySession;
                if (!adapter || adapter.ended) {
                    return null;
                }
                return {
                    mode: adapter.mode,
                    enabledFeatures: adapter.enabledFeatures,
                    visibilityState: adapter.session.visibilityState,
                    originOffsetMatrix: null,
                    end: () => adapter.session.end(),
                };
            },
            onActionPlayerCreated: this.options.mode === 'full'
                ? (player) => this.wirePlayer(player)
                : undefined,
        };
        this.installedState = true;
        this.capabilityState.phase = 'installed';
        this.capabilityState.requestSession = true;
    }
    uninstall() {
        if (!this.installedState) {
            return;
        }
        this.installedState = false;
        for (const adapter of Array.from(this.liveSessions)) {
            this.detachAdapter(adapter, true);
        }
        this.unwirePlayer();
        this.patches.revert();
        if (this.previousRuntime) {
            this.device[P_DEVICE].runtime = this.previousRuntime;
            this.previousRuntime = null;
        }
        this.resetPatchTracking();
        this.playbackFrame = null;
        this.warned.clear();
        Object.assign(this.capabilityState, {
            phase: 'uninstalled',
            ...clearedCapabilities(),
            notes: [],
        });
    }
    /**
     * Splits a session request into what the browser is asked for and what IWER
     * answers itself. The caller's dictionary is never mutated: applications
     * legitimately reuse (and freeze) one options object across requests.
     */
    prepareSessionRequest(options) {
        var _a, _b;
        const requiredFeatures = Array.from((_a = options === null || options === void 0 ? void 0 : options.requiredFeatures) !== null && _a !== void 0 ? _a : []);
        const optionalFeatures = Array.from((_b = options === null || options === void 0 ? void 0 : options.optionalFeatures) !== null && _b !== void 0 ? _b : []);
        const required = requiredFeatures.filter(isGazeTrackingFeature);
        const optional = optionalFeatures.filter(isGazeTrackingFeature);
        const supported = supportsGazeTracking(this.device.supportedFeatures);
        if (optional.length > 0 && !supported) {
            this.note('Optional gaze tracking was not enabled because the selected IWER device profile does not advertise gaze support.', 'unsupported-optional-gaze');
        }
        if (required.length > 0 && !supported) {
            // Native input sources are suppressed and replaced by the selected IWER
            // profile. Forwarding this request would therefore expose an enabled
            // feature with no corresponding gaze source.
            throw notSupported(`Required gaze tracking is unavailable because the selected IWER device profile "${this.device.name}" does not advertise gaze support. Select a gaze-capable profile such as metaQuestPro.`);
        }
        const enabled = supported
            ? Array.from(new Set([...required, ...optional]))
            : [];
        if (!options) {
            return { options: undefined, gaze: { required, optional, enabled } };
        }
        const nativeOptions = { ...options };
        if (options.requiredFeatures) {
            nativeOptions.requiredFeatures = requiredFeatures.filter((feature) => !isGazeTrackingFeature(feature));
        }
        if (options.optionalFeatures) {
            nativeOptions.optionalFeatures = optionalFeatures.filter((feature) => !isGazeTrackingFeature(feature));
        }
        return { options: nativeOptions, gaze: { required, optional, enabled } };
    }
    /**
     * A session that asked for a gaze alias must never resolve without its gaze
     * source, so an override that went away mid-request fails the attach instead
     * of quietly handing back the unmodified native session.
     */
    failWhenGazeRequested(syntheticGazeFeatures) {
        if (syntheticGazeFeatures.length > 0) {
            throw notSupported('Native override was uninstalled before the session could attach.');
        }
    }
    async attachSession(session, mode, syntheticGazeFeatures = []) {
        var _a, _b;
        var _c, _d, _e, _f;
        if (!this.installedState) {
            this.failWhenGazeRequested(syntheticGazeFeatures);
            return;
        }
        if (this.sessionsByObject.has(session)) {
            return;
        }
        const nativeRequestReferenceSpace = this.captureNativeRequestReferenceSpace(session);
        const nativeRequestAnimationFrame = this.captureNativeRequestAnimationFrame(session);
        const nativeInputSources = this.options.mode === 'gaze-only'
            ? this.captureNativeInputSources(session)
            : { read: () => [], live: false };
        let anchorSpace;
        let anchorType;
        for (const type of [
            'local-floor',
            'local',
            'unbounded',
        ]) {
            try {
                anchorSpace = await nativeRequestReferenceSpace.call(session, type);
                anchorType = type;
                break;
            }
            catch (_g) {
                // Try the next stable, world-locked reference-space type.
            }
        }
        if (!anchorSpace || !anchorType) {
            throw new Error('No native local-floor, local, or unbounded reference space is available.');
        }
        if (anchorType !== 'local-floor') {
            this.note(`Native local-floor is unavailable; poses are anchored to "${anchorType}" and are offset by the viewer's initial height.`);
        }
        if (!this.installedState) {
            this.failWhenGazeRequested(syntheticGazeFeatures);
            return;
        }
        // Seed as late as possible: requesting the anchor space is asynchronous,
        // and native sources may connect while those requests are in flight.
        const initialNativeSources = nativeInputSources.read();
        const adapter = {
            session,
            mode,
            anchorSpace,
            handTracking: this.sessionEnablesHandTracking(session),
            enabledFeatures: Object.freeze(Array.from(new Set([
                ...Array.from((_a = session.enabledFeatures) !== null && _a !== void 0 ? _a : []),
                ...syntheticGazeFeatures,
            ]))),
            syntheticGazeFeatures: Object.freeze([...syntheticGazeFeatures]),
            nativeRequestAnimationFrame,
            nativeRequestReferenceSpace,
            nativeInputSources: nativeInputSources.read,
            nativeInputSourcesLive: nativeInputSources.live,
            nativeSources: Object.freeze([...initialNativeSources]),
            patches: new PatchRegistry(),
            instancePatches: new PatchRegistry(),
            cleanupListeners: [],
            sources: Object.freeze(this.options.mode === 'gaze-only'
                ? Array.from(initialNativeSources)
                : []),
            deviceBindings: [],
            playbackBindings: new Map(),
            bindingByFacade: new Map(),
            spaceTokens: new Set([anchorSpace]),
            hitTests: new Set(),
            baseSpaceCache: new Map(),
            lastFrameTime: undefined,
            lastPreparedFrame: null,
            nativeViewerPoseValid: this.options.mode === 'full',
            nativeViewerMatrix: create$5(),
            framePreparationFailures: 0,
            activeFrame: null,
            framesInstrumented: false,
            pendingEvents: [],
            retainedSources: new Set(),
            createAnchorAvailable: true,
            hitTestResultsAvailable: true,
            ended: false,
        };
        this.sessionsByObject.set(session, adapter);
        this.liveSessions.add(adapter);
        (_b = this.primarySession) !== null && _b !== void 0 ? _b : (this.primarySession = adapter);
        this.spaces.set(anchorSpace, {
            adapter,
            localOffset: create$5(),
        });
        const handInputBeforeAttach = this.capabilityState.handInput;
        try {
            if (this.options.mode === 'full') {
                this.ensureReferenceSpacePatch(anchorSpace, adapter);
            }
            this.createDeviceBindings(adapter);
            const enabledFeaturesPatched = this.patchEnabledFeatures(adapter);
            const inputSourcesPatched = this.patchInputSources(adapter);
            const rafPatched = this.patchRequestAnimationFrame(adapter);
            adapter.framesInstrumented = rafPatched;
            const referenceSpacesPatched = this.options.mode === 'full'
                ? this.patchRequestReferenceSpace(adapter)
                : false;
            if (this.options.mode === 'full') {
                this.patchRequestHitTestSource(adapter);
            }
            this.installSessionListeners(adapter);
            if (!inputSourcesPatched) {
                // Gaze exists only as a synthetic input source, so a session that
                // asked for it cannot degrade to native input the way others can.
                if (syntheticGazeFeatures.length > 0) {
                    throw notSupported('Unable to expose the synthetic gaze input source.');
                }
                this.unsupportedForSession(adapter, 'Unable to override XRSession.inputSources.');
            }
            if (!rafPatched) {
                if (syntheticGazeFeatures.length > 0) {
                    throw notSupported('Unable to update the synthetic gaze input on native frames.');
                }
                this.unsupportedForSession(adapter, 'Unable to wrap XRSession.requestAnimationFrame.');
            }
            if (this.options.mode === 'full' && !referenceSpacesPatched) {
                this.note('XRReferenceSpace tagging is unavailable; viewer-relative offset spaces will use native behavior.');
            }
            if (!enabledFeaturesPatched && syntheticGazeFeatures.length > 0) {
                throw notSupported('Unable to expose the synthetic gaze feature through XRSession.enabledFeatures.');
            }
            (_c = this.capabilityState).inputSources || (_c.inputSources = inputSourcesPatched);
            (_d = this.capabilityState).inputEvents || (_d.inputEvents = inputSourcesPatched && rafPatched);
            (_e = this.capabilityState).enabledFeatures || (_e.enabledFeatures = enabledFeaturesPatched);
            (_f = this.capabilityState).viewerSpaceTagging || (_f.viewerSpaceTagging = referenceSpacesPatched);
            if (this.capabilityState.phase === 'installed') {
                this.capabilityState.phase = 'attached';
            }
        }
        catch (error) {
            this.capabilityState.handInput = handInputBeforeAttach;
            this.detachAdapter(adapter);
            throw error;
        }
    }
    sessionEnablesHandTracking(session) {
        const features = session.enabledFeatures;
        if (features) {
            return Array.prototype.includes.call(features, HAND_TRACKING_FEATURE);
        }
        // Browsers without enabledFeatures cannot report the negotiated feature
        // set, so fall back to what the emulated device advertises.
        return this.device.supportedFeatures.includes(HAND_TRACKING_FEATURE);
    }
    // ===========================================================================
    // Input bindings
    // ===========================================================================
    createDeviceBindings(adapter) {
        if (this.options.mode === 'full') {
            for (const controller of Object.values(this.device.controllers)) {
                adapter.deviceBindings.push(this.createInputBinding(adapter, 'controller', controller.inputSource, {
                    trackedInput: controller,
                    exposeHand: false,
                }));
            }
            if (adapter.handTracking) {
                for (const hand of Object.values(this.device.hands)) {
                    adapter.deviceBindings.push(this.createInputBinding(adapter, 'hand', hand.inputSource, {
                        trackedInput: hand,
                        exposeHand: true,
                    }));
                }
            }
        }
        if (adapter.syntheticGazeFeatures.length > 0) {
            const gaze = this.device.gaze;
            if (!gaze) {
                throw new Error('The selected device does not provide a synthetic gaze input.');
            }
            adapter.deviceBindings.push(this.createInputBinding(adapter, 'gaze', gaze.inputSource, {
                trackedInput: gaze,
                exposeHand: false,
                available: this.options.mode === 'gaze-only'
                    ? () => adapter.nativeViewerPoseValid
                    : undefined,
            }));
        }
    }
    createInputBinding(adapter, kind, iwerSource, options) {
        const targetRaySpace = this.createSpaceToken(adapter);
        this.spaces.set(targetRaySpace, {
            adapter,
            origin: () => iwerSource.targetRaySpace,
            available: options.available,
            localOffset: create$5(),
        });
        let gripSpace;
        if (iwerSource.gripSpace) {
            gripSpace = this.createSpaceToken(adapter);
            this.spaces.set(gripSpace, {
                adapter,
                origin: () => { var _a; return (_a = iwerSource.gripSpace) !== null && _a !== void 0 ? _a : null; },
                available: options.available,
                localOffset: create$5(),
            });
        }
        const joints = [];
        if (options.exposeHand && iwerSource.hand) {
            for (const name of Object.values(XRHandJoint)) {
                const source = iwerSource.hand.get(name);
                if (!source) {
                    continue;
                }
                const joint = {
                    name,
                    space: this.createJointSpaceFacade(name),
                    source,
                };
                this.spaces.set(joint.space, {
                    adapter,
                    origin: () => joint.source,
                    available: options.available,
                    localOffset: create$5(),
                    joint,
                });
                joints.push(joint);
            }
        }
        const binding = {
            kind,
            iwerSource,
            trackedInput: options.trackedInput,
            inputSource: undefined,
            targetRaySpace,
            gripSpace,
            joints,
            eventButtons: this.eventButtons(iwerSource),
            previousButtonValues: new Map(),
            activeButtons: new Set(),
            activeActions: new Set(),
            pendingActions: new Set(),
        };
        binding.inputSource = this.createInputSourceFacade(binding, adapter);
        this.resetButtonBaseline(binding);
        adapter.bindingByFacade.set(binding.inputSource, binding);
        if (joints.length > 0) {
            this.capabilityState.handInput = true;
        }
        return binding;
    }
    /**
     * Returns the stable binding for a recorded playback source, creating it on
     * first use so the application always observes the same facade objects.
     */
    playbackBinding(adapter, source) {
        const existing = adapter.playbackBindings.get(source);
        if (existing) {
            return existing;
        }
        const exposeHand = Boolean(source.hand) && adapter.handTracking;
        if (source.hand && !adapter.handTracking) {
            this.note(`Recorded hand joints are hidden because the native session does not enable the "${HAND_TRACKING_FEATURE}" feature.`);
        }
        const binding = this.createInputBinding(adapter, 'playback', source, {
            exposeHand,
        });
        adapter.playbackBindings.set(source, binding);
        return binding;
    }
    /**
     * Allocates a distinct native reference space to use as a stable synthetic
     * space token. Browsers must return a fresh object for every call, otherwise
     * IWER cannot tell the target-ray and grip spaces apart.
     */
    createSpaceToken(adapter) {
        const identity = new (this.getRigidTransformConstructor())();
        const token = adapter.anchorSpace.getOffsetReferenceSpace(identity);
        if (adapter.spaceTokens.has(token)) {
            throw new Error('Native getOffsetReferenceSpace(identity) reused a space object; stable synthetic input tokens require distinct objects.');
        }
        adapter.spaceTokens.add(token);
        return token;
    }
    createInputSourceFacade(binding, adapter) {
        var _a;
        const inputPrototype = this.constructorPrototype('XRInputSource');
        const facade = Object.create(inputPrototype !== null && inputPrototype !== void 0 ? inputPrototype : Object.prototype);
        const iwerSource = binding.iwerSource;
        // Hand input sources expose no gamepad per WebXR Hand Input. The IWER pinch
        // gamepad still drives select transitions through binding.eventButtons.
        const gamepad = binding.joints.length > 0 || !iwerSource.gamepad
            ? null
            : this.createGamepadFacade(binding, adapter);
        Object.defineProperties(facade, {
            handedness: {
                configurable: true,
                enumerable: true,
                value: iwerSource.handedness,
            },
            targetRayMode: {
                configurable: true,
                enumerable: true,
                value: iwerSource.targetRayMode,
            },
            profiles: {
                configurable: true,
                enumerable: true,
                value: Object.freeze([...iwerSource.profiles]),
            },
            targetRaySpace: {
                configurable: true,
                enumerable: true,
                value: binding.targetRaySpace,
            },
            gripSpace: {
                configurable: true,
                enumerable: true,
                value: (_a = binding.gripSpace) !== null && _a !== void 0 ? _a : null,
            },
            gamepad: { configurable: true, enumerable: true, value: gamepad },
            hand: {
                configurable: true,
                enumerable: true,
                value: binding.joints.length > 0
                    ? this.createHandFacade(binding.joints)
                    : null,
            },
        });
        return facade;
    }
    /**
     * Builds an XRHand-shaped maplike facade. The prototype is borrowed from the
     * browser so branded checks succeed, while every maplike method is an own
     * property because native XRHand methods reject foreign receivers.
     */
    createHandFacade(joints) {
        const prototype = this.constructorPrototype('XRHand');
        const facade = Object.create(prototype !== null && prototype !== void 0 ? prototype : Object.prototype);
        const entries = new Map(joints.map((joint) => [joint.name, joint.space]));
        const define = (key, value) => {
            Object.defineProperty(facade, key, {
                configurable: true,
                writable: true,
                value,
            });
        };
        Object.defineProperty(facade, 'size', {
            configurable: true,
            enumerable: true,
            get: () => entries.size,
        });
        define('get', (joint) => entries.get(joint));
        define('has', (joint) => entries.has(joint));
        define('keys', () => entries.keys());
        define('values', () => entries.values());
        define('entries', () => entries.entries());
        define('forEach', function (callback, thisArg) {
            entries.forEach((value, key) => {
                callback.call(thisArg, value, key, facade);
            });
        });
        define(Symbol.iterator, () => entries.entries());
        return facade;
    }
    /** Builds a stable XRJointSpace-shaped object for one hand joint. */
    createJointSpaceFacade(name) {
        var _a;
        const prototype = (_a = this.constructorPrototype('XRJointSpace')) !== null && _a !== void 0 ? _a : this.constructorPrototype('XRSpace');
        const facade = Object.create(prototype !== null && prototype !== void 0 ? prototype : Object.prototype);
        Object.defineProperty(facade, 'jointName', {
            configurable: true,
            enumerable: true,
            value: name,
        });
        return facade;
    }
    createGamepadFacade(binding, adapter) {
        const prototype = this.constructorPrototype('Gamepad');
        const facade = Object.create(prototype !== null && prototype !== void 0 ? prototype : Object.prototype);
        const gamepad = binding.iwerSource.gamepad;
        let axes = Object.freeze(gamepad.axes.map((value) => value !== null && value !== void 0 ? value : 0));
        const buttons = Object.freeze(gamepad.buttons.map((button) => Object.freeze({
            get pressed() {
                var _a;
                return (_a = button === null || button === void 0 ? void 0 : button.pressed) !== null && _a !== void 0 ? _a : false;
            },
            get touched() {
                var _a;
                return (_a = button === null || button === void 0 ? void 0 : button.touched) !== null && _a !== void 0 ? _a : false;
            },
            get value() {
                var _a;
                return (_a = button === null || button === void 0 ? void 0 : button.value) !== null && _a !== void 0 ? _a : 0;
            },
        })));
        const hapticActuators = Object.freeze([...gamepad.hapticActuators]);
        Object.defineProperties(facade, {
            id: {
                configurable: true,
                enumerable: true,
                value: '',
            },
            index: { configurable: true, enumerable: true, value: -1 },
            connected: {
                configurable: true,
                enumerable: true,
                get: () => { var _a, _b; return ((_b = (_a = binding.trackedInput) === null || _a === void 0 ? void 0 : _a.connected) !== null && _b !== void 0 ? _b : true) && !adapter.ended; },
            },
            timestamp: {
                configurable: true,
                enumerable: true,
                get: () => { var _a; return (_a = adapter.lastFrameTime) !== null && _a !== void 0 ? _a : 0; },
            },
            mapping: {
                configurable: true,
                enumerable: true,
                get: () => gamepad.mapping,
            },
            axes: {
                configurable: true,
                enumerable: true,
                get: () => {
                    const current = gamepad.axes.map((value) => value !== null && value !== void 0 ? value : 0);
                    if (current.length !== axes.length ||
                        current.some((value, index) => value !== axes[index])) {
                        axes = Object.freeze(current);
                    }
                    return axes;
                },
            },
            buttons: {
                configurable: true,
                enumerable: true,
                get: () => buttons,
            },
            hapticActuators: {
                configurable: true,
                enumerable: true,
                get: () => hapticActuators,
            },
            vibrationActuator: {
                configurable: true,
                enumerable: true,
                get: () => gamepad.vibrationActuator,
            },
        });
        return facade;
    }
    eventButtons(iwerSource) {
        const gamepad = iwerSource.gamepad;
        if (!gamepad) {
            return [];
        }
        return Object.values(gamepad[P_GAMEPAD].buttonsMap).filter((button) => button !== null);
    }
    resetButtonBaseline(binding) {
        for (const button of binding.eventButtons) {
            binding.previousButtonValues.set(button, button.value);
        }
    }
    /**
     * Forgets any in-progress action for a binding whose source just appeared or
     * disappeared, so a later removal cannot synthesize a duplicate end event.
     */
    clearActionState(binding) {
        binding.activeButtons.clear();
        binding.activeActions.clear();
        binding.pendingActions.clear();
    }
    // ===========================================================================
    // Session patches
    // ===========================================================================
    /**
     * Captures the browser method behind a prototype patch exactly once. A later
     * session otherwise sees IWER's wrapper as its "native" method and recurses.
     */
    captureNativeRequestAnimationFrame(session) {
        const found = methodDescriptor(session, 'requestAnimationFrame');
        if (!found || typeof found.descriptor.value !== 'function') {
            throw new Error('Native XRSession.requestAnimationFrame is unavailable.');
        }
        const cached = this.rawRafByOwner.get(found.owner);
        if (cached) {
            return cached;
        }
        const nativeMethod = found.descriptor
            .value;
        this.rawRafByOwner.set(found.owner, nativeMethod);
        return nativeMethod;
    }
    captureNativeRequestReferenceSpace(session) {
        const found = methodDescriptor(session, 'requestReferenceSpace');
        if (!found || typeof found.descriptor.value !== 'function') {
            throw new Error('Native XRSession.requestReferenceSpace is unavailable.');
        }
        const cached = this.rawRequestReferenceSpaceByOwner.get(found.owner);
        if (cached) {
            return cached;
        }
        const nativeMethod = found.descriptor
            .value;
        this.rawRequestReferenceSpaceByOwner.set(found.owner, nativeMethod);
        return nativeMethod;
    }
    /** Capture the browser's input-source getter before it is wrapped. */
    captureNativeInputSources(session) {
        const found = methodDescriptor(session, 'inputSources');
        if (!found) {
            throw new Error('Native XRSession.inputSources is unavailable.');
        }
        let nativeGetter = this.rawInputSourcesGetterByOwner.get(found.owner);
        if (!nativeGetter && found.descriptor.get) {
            nativeGetter = found.descriptor.get;
            this.rawInputSourcesGetterByOwner.set(found.owner, nativeGetter);
        }
        if (nativeGetter) {
            return {
                read: () => { var _a; return Array.from((_a = nativeGetter.call(session)) !== null && _a !== void 0 ? _a : []); },
                live: true,
            };
        }
        if ('value' in found.descriptor) {
            const initialNativeSources = found.descriptor.value;
            return {
                read: () => {
                    // Before IWER installs its facade, observe a replacement of the own
                    // data property as well as in-place mutations of the initial array.
                    const current = Object.getOwnPropertyDescriptor(session, 'inputSources');
                    const sources = current && 'value' in current
                        ? current.value
                        : initialNativeSources;
                    return Array.from(sources !== null && sources !== void 0 ? sources : []);
                },
                live: false,
            };
        }
        throw new Error('Native XRSession.inputSources cannot be read.');
    }
    /**
     * Re-reports the aliases IWER answered itself through the session property
     * applications actually read. Only patched when there is something to add,
     * so a session without synthetic features keeps the browser's own array.
     */
    patchEnabledFeatures(adapter) {
        var _a, _b;
        if (adapter.syntheticGazeFeatures.length === 0) {
            return false;
        }
        if (adapter.patches.define(adapter.session, 'enabledFeatures', {
            configurable: true,
            enumerable: true,
            value: adapter.enabledFeatures,
        })) {
            const exposed = Array.from((_a = adapter.session.enabledFeatures) !== null && _a !== void 0 ? _a : []);
            return adapter.syntheticGazeFeatures.every((feature) => exposed.includes(feature));
        }
        const found = methodDescriptor(adapter.session, 'enabledFeatures');
        const nativeGetter = found === null || found === void 0 ? void 0 : found.descriptor.get;
        if (!found || !nativeGetter) {
            return false;
        }
        if (!this.patchedEnabledFeaturesOwners.has(found.owner)) {
            const owner = this;
            const patched = this.patches.define(found.owner, 'enabledFeatures', {
                ...found.descriptor,
                get() {
                    var _a, _b;
                    return ((_b = (_a = owner.sessionsByObject.get(this)) === null || _a === void 0 ? void 0 : _a.enabledFeatures) !== null && _b !== void 0 ? _b : nativeGetter.call(this));
                },
            });
            if (!patched) {
                return false;
            }
            this.patchedEnabledFeaturesOwners.add(found.owner);
        }
        const exposed = Array.from((_b = adapter.session.enabledFeatures) !== null && _b !== void 0 ? _b : []);
        return adapter.syntheticGazeFeatures.every((feature) => exposed.includes(feature));
    }
    patchInputSources(adapter) {
        if (adapter.patches.define(adapter.session, 'inputSources', {
            configurable: true,
            enumerable: true,
            get: () => adapter.sources,
        })) {
            return adapter.session.inputSources === adapter.sources;
        }
        const found = methodDescriptor(adapter.session, 'inputSources');
        const nativeGetter = found === null || found === void 0 ? void 0 : found.descriptor.get;
        if (!found || !nativeGetter) {
            return false;
        }
        if (!this.patchedInputSourceOwners.has(found.owner)) {
            const owner = this;
            const patched = this.patches.define(found.owner, 'inputSources', {
                ...found.descriptor,
                get() {
                    var _a, _b;
                    return ((_b = (_a = owner.sessionsByObject.get(this)) === null || _a === void 0 ? void 0 : _a.sources) !== null && _b !== void 0 ? _b : nativeGetter.call(this));
                },
            });
            if (!patched) {
                return false;
            }
            this.patchedInputSourceOwners.add(found.owner);
        }
        return adapter.session.inputSources === adapter.sources;
    }
    patchRequestAnimationFrame(adapter) {
        const owner = this;
        const wrapped = function (callback) {
            return adapter.nativeRequestAnimationFrame.call(this, (time, frame) => {
                owner.prepareFrameCallback(adapter, time, frame);
                try {
                    callback(time, frame);
                }
                finally {
                    owner.releaseFrameCallback(adapter, frame);
                }
            });
        };
        if (adapter.patches.define(adapter.session, 'requestAnimationFrame', {
            configurable: true,
            writable: true,
            value: wrapped,
        })) {
            return true;
        }
        const found = methodDescriptor(adapter.session, 'requestAnimationFrame');
        const nativeMethod = found === null || found === void 0 ? void 0 : found.descriptor.value;
        if (!found || typeof nativeMethod !== 'function') {
            return false;
        }
        if (!this.patchedRafOwners.has(found.owner)) {
            const patched = this.patches.define(found.owner, 'requestAnimationFrame', {
                ...found.descriptor,
                value(callback) {
                    const current = owner.sessionsByObject.get(this);
                    if (!current) {
                        return nativeMethod.call(this, callback);
                    }
                    return current.nativeRequestAnimationFrame.call(this, (time, frame) => {
                        owner.prepareFrameCallback(current, time, frame);
                        try {
                            callback(time, frame);
                        }
                        finally {
                            owner.releaseFrameCallback(current, frame);
                        }
                    });
                },
            });
            if (!patched) {
                return false;
            }
            this.patchedRafOwners.add(found.owner);
        }
        return true;
    }
    patchRequestReferenceSpace(adapter) {
        const owner = this;
        const wrapped = function (type) {
            return adapter.nativeRequestReferenceSpace
                .call(this, type)
                .then((space) => {
                owner.tagRequestedReferenceSpace(adapter, space, type);
                owner.ensureReferenceSpacePatch(space, adapter);
                return space;
            });
        };
        if (adapter.patches.define(adapter.session, 'requestReferenceSpace', {
            configurable: true,
            writable: true,
            value: wrapped,
        })) {
            return true;
        }
        const found = methodDescriptor(adapter.session, 'requestReferenceSpace');
        const nativeMethod = found === null || found === void 0 ? void 0 : found.descriptor.value;
        if (!found || typeof nativeMethod !== 'function') {
            return false;
        }
        if (!this.patchedRequestReferenceSpaceOwners.has(found.owner)) {
            const patched = this.patches.define(found.owner, 'requestReferenceSpace', {
                ...found.descriptor,
                value(type) {
                    const current = owner.sessionsByObject.get(this);
                    if (!current) {
                        return nativeMethod.call(this, type);
                    }
                    return current.nativeRequestReferenceSpace
                        .call(this, type)
                        .then((space) => {
                        owner.tagRequestedReferenceSpace(current, space, type);
                        owner.ensureReferenceSpacePatch(space, current);
                        return space;
                    });
                },
            });
            if (!patched) {
                return false;
            }
            this.patchedRequestReferenceSpaceOwners.add(found.owner);
        }
        return true;
    }
    patchRequestHitTestSource(adapter) {
        const nativeMethod = adapter.session.requestHitTestSource;
        if (typeof nativeMethod !== 'function') {
            return;
        }
        const owner = this;
        const wrapped = function (options) {
            return owner.handleRequestHitTestSource(this, nativeMethod, options);
        };
        if (adapter.patches.define(adapter.session, 'requestHitTestSource', {
            configurable: true,
            writable: true,
            value: wrapped,
        })) {
            return;
        }
        const found = methodDescriptor(adapter.session, 'requestHitTestSource');
        if (!found ||
            typeof found.descriptor.value !== 'function' ||
            this.patchedHitTestOwners.has(found.owner)) {
            return;
        }
        const prototypeMethod = found.descriptor
            .value;
        const patched = this.patches.define(found.owner, 'requestHitTestSource', {
            ...found.descriptor,
            value(options) {
                return owner.handleRequestHitTestSource(this, prototypeMethod, options);
            },
        });
        if (patched) {
            this.patchedHitTestOwners.add(found.owner);
        }
    }
    tagRequestedReferenceSpace(adapter, space, type) {
        if (this.spaces.has(space)) {
            return;
        }
        if (type === 'viewer') {
            this.spaces.set(space, {
                adapter,
                origin: () => this.currentViewerSpace(),
                localOffset: create$5(),
            });
        }
    }
    ensureReferenceSpacePatch(space, adapter) {
        if (this.instancePatchedReferenceSpaces.has(space)) {
            return;
        }
        const found = methodDescriptor(space, 'getOffsetReferenceSpace');
        const nativeMethod = found === null || found === void 0 ? void 0 : found.descriptor.value;
        if (!found || typeof nativeMethod !== 'function') {
            return;
        }
        const owner = this;
        const wrapper = function (originOffset) {
            const info = owner.spaces.get(this);
            if (!info || info.adapter.ended) {
                return nativeMethod.call(this, originOffset);
            }
            const derived = nativeMethod.call(this, originOffset);
            owner.propagateSpaceMetadata(this, derived, originOffset);
            owner.ensureReferenceSpacePatch(derived, info.adapter);
            return derived;
        };
        if (found.owner !== space &&
            !this.patchedReferenceSpaceOwners.has(found.owner)) {
            const patched = this.patches.define(found.owner, 'getOffsetReferenceSpace', {
                ...found.descriptor,
                value: wrapper,
            });
            if (patched) {
                this.patchedReferenceSpaceOwners.add(found.owner);
                return;
            }
        }
        else if (found.owner !== space) {
            return;
        }
        const patched = adapter.patches.define(space, 'getOffsetReferenceSpace', {
            configurable: true,
            writable: true,
            value: wrapper,
        });
        if (patched) {
            this.instancePatchedReferenceSpaces.add(space);
        }
    }
    propagateSpaceMetadata(parent, derived, originOffset) {
        const info = this.spaces.get(parent);
        if (!info) {
            return;
        }
        const localOffset = create$5();
        multiply$2(localOffset, info.localOffset, matrixFromTransform(originOffset));
        // An offset space derived from a joint is no longer a joint; only the
        // origin and the accumulated offset carry over.
        this.spaces.set(derived, {
            adapter: info.adapter,
            origin: info.origin,
            available: info.available,
            localOffset,
        });
    }
    installSessionListeners(adapter) {
        const { session } = adapter;
        if (this.options.mode === 'full') {
            const suppressNativeInput = (event) => {
                if (!this.syntheticEvents.has(event)) {
                    event.stopImmediatePropagation();
                }
            };
            for (const type of ['inputsourceschange', ...INPUT_EVENT_NAMES]) {
                session.addEventListener(type, suppressNativeInput, true);
                adapter.cleanupListeners.push(() => session.removeEventListener(type, suppressNativeInput, true));
            }
        }
        else {
            // Run before application listeners (the session has not escaped
            // requestSession yet) so session.inputSources already reflects the
            // browser's new membership when its native event is observed.
            const syncNativeSources = (event) => {
                if (this.syntheticEvents.has(event)) {
                    return;
                }
                try {
                    if (!adapter.nativeInputSourcesLive) {
                        const change = event;
                        if (change.added == null || change.removed == null) {
                            adapter.nativeSources = Object.freeze([
                                ...adapter.nativeInputSources(),
                            ]);
                        }
                        else {
                            const removed = new Set(Array.from(change.removed));
                            const nativeSources = adapter.nativeSources.filter((source) => !removed.has(source));
                            for (const source of Array.from(change.added)) {
                                if (!nativeSources.includes(source)) {
                                    nativeSources.push(source);
                                }
                            }
                            adapter.nativeSources = Object.freeze(nativeSources);
                        }
                    }
                }
                catch (error) {
                    try {
                        adapter.nativeSources = Object.freeze([
                            ...adapter.nativeInputSources(),
                        ]);
                    }
                    catch (readError) {
                        this.note(`A native input-source change could not be reconciled; preserving the last known set: ${this.errorText(readError !== null && readError !== void 0 ? readError : error)}`, 'gaze-only-native-input-change-failed');
                    }
                }
                this.refreshInputSources(adapter, true);
            };
            session.addEventListener('inputsourceschange', syncNativeSources, true);
            adapter.cleanupListeners.push(() => session.removeEventListener('inputsourceschange', syncNativeSources, true));
        }
        const onVisibilityChange = () => {
            var _a;
            const driver = this.sharedStateDriver();
            this.device[P_DEVICE].visibilityState =
                (_a = driver === null || driver === void 0 ? void 0 : driver.session.visibilityState) !== null && _a !== void 0 ? _a : session.visibilityState;
            this.device[P_DEVICE].pendingVisibilityState = null;
            // Native runtimes publish their initial input set from the frame loop.
            // Preserve that timing even if visibility changes before frame one.
            if (adapter.lastFrameTime !== undefined) {
                this.refreshInputSources(adapter, true);
            }
        };
        session.addEventListener('visibilitychange', onVisibilityChange);
        adapter.cleanupListeners.push(() => session.removeEventListener('visibilitychange', onVisibilityChange));
        const onEnd = () => this.detachAdapter(adapter);
        session.addEventListener('end', onEnd, { once: true });
        adapter.cleanupListeners.push(() => session.removeEventListener('end', onEnd));
    }
    // ===========================================================================
    // Frame loop
    // ===========================================================================
    tick(adapter, time, frame) {
        if (adapter.ended ||
            (adapter.lastFrameTime === time && adapter.lastPreparedFrame === frame)) {
            return;
        }
        adapter.lastFrameTime = time;
        adapter.lastPreparedFrame = frame;
        adapter.baseSpaceCache.clear();
        if (this.options.mode === 'gaze-only') {
            this.syncDeviceViewerFromNative(adapter, frame);
        }
        if (adapter === this.sharedStateDriver()) {
            this.advanceSharedState(adapter, time);
        }
        // Publish first (so a recording's edges address a visible input source),
        // then drain, then publish again to release any source that was only kept
        // alive for the drain. Both passes are no-ops when nothing changed.
        this.refreshInputSources(adapter, true);
        this.drainPendingEvents(adapter, frame);
        this.refreshInputSources(adapter, true);
        this.dispatchButtonTransitions(adapter, frame);
        this.updateHitTestSources(adapter);
    }
    /**
     * Keep the synthetic gaze origin coincident with the physical headset while
     * leaving the browser-owned viewer pose untouched.
     */
    syncDeviceViewerFromNative(adapter, frame) {
        adapter.nativeViewerPoseValid = false;
        const found = methodDescriptor(frame, 'getViewerPose');
        const nativeMethod = found === null || found === void 0 ? void 0 : found.descriptor.value;
        if (!found || typeof nativeMethod !== 'function') {
            this.note('The native XRFrame.getViewerPose implementation is unavailable; synthetic gaze is untracked for this frame.', 'gaze-only-viewer-pose-unavailable');
            return;
        }
        let pose;
        try {
            pose = nativeMethod.call(frame, adapter.anchorSpace);
        }
        catch (_a) {
            return;
        }
        if (!pose) {
            return;
        }
        const transform = this.readNativeTransform(pose);
        if (!transform) {
            return;
        }
        const matrix = matrixFromTransform(transform);
        copy$3(adapter.nativeViewerMatrix, matrix);
        this.applyDeviceViewerMatrix(matrix);
        adapter.nativeViewerPoseValid = true;
    }
    applyDeviceViewerMatrix(matrix) {
        getTranslation(scratchPosition, matrix);
        getRotation(scratchOrientation, matrix);
        this.device.position.set(scratchPosition[0], scratchPosition[1], scratchPosition[2]);
        this.device.quaternion.set(scratchOrientation[0], scratchOrientation[1], scratchOrientation[2], scratchOrientation[3]);
        this.device[P_DEVICE].updateViews();
    }
    /**
     * Uses the primary session while it is visible, otherwise the first visible
     * session. Native runtimes normally expose one immersive session, but this
     * keeps shared device state live in runtimes that permit concurrent sessions.
     */
    sharedStateDriver() {
        var _a, _b;
        if (((_a = this.primarySession) === null || _a === void 0 ? void 0 : _a.session.visibilityState) === 'visible') {
            return this.primarySession;
        }
        return ((_b = Array.from(this.liveSessions).find((adapter) => adapter.session.visibilityState === 'visible')) !== null && _b !== void 0 ? _b : this.primarySession);
    }
    advanceSharedState(adapter, time) {
        var _a;
        const previousTime = this.lastPrimaryTime;
        this.lastPrimaryTime = time;
        const delta = previousTime === undefined ? 16.67 : Math.max(0, time - previousTime);
        if (this.options.mode === 'gaze-only') {
            this.device[P_DEVICE].remote.update(delta);
            // A queued command may target the synthetic device's viewer. Reassert
            // the browser-owned pose so gaze-only mode cannot move the real view or
            // offset the gaze origin away from the physical headset.
            if (adapter.nativeViewerPoseValid) {
                this.applyDeviceViewerMatrix(adapter.nativeViewerMatrix);
            }
            this.device[P_DEVICE].visibilityState = adapter.session.visibilityState;
            this.device[P_DEVICE].pendingVisibilityState = null;
            (_a = this.device.gaze) === null || _a === void 0 ? void 0 : _a.updateTargetRaySpace();
            return;
        }
        this.device[P_DEVICE].remote.update(delta);
        this.device[P_DEVICE].visibilityState = adapter.session.visibilityState;
        this.device[P_DEVICE].pendingVisibilityState = null;
        const player = this.device[P_DEVICE].actionPlayer;
        if (player &&
            (player.playing || player[P_ACTION_PLAYER].manualFrameActive)) {
            this.wirePlayer(player);
            // Sample exactly once per primary native frame timestamp. playFrame()
            // clears `playing` on the final frame, so remember that this frame was
            // produced by the player and keep routing through it for its duration.
            this.playbackFrame = player;
            this.capabilityState.actionPlayback = true;
            if (player.playing && player[P_ACTION_PLAYER].autoAdvance) {
                player.playFrame();
            }
        }
        else {
            this.playbackFrame = null;
            if (this.wiredPlayer && this.wiredPlayer !== player) {
                this.unwirePlayer();
            }
            this.updateDeviceInputs();
        }
        this.device[P_DEVICE].updateViews();
    }
    /**
     * Mirrors XRTrackedInput.onFrameStart's state advance for the inputs the
     * device currently exposes: snapshot the target-ray pose, apply pending
     * gamepad values, and refresh interpolated hand joints.
     *
     * This reads the shared device rather than any one session's bindings, so a
     * session that cannot publish a given input kind (a session without
     * hand-tracking, say) never stalls that input for the other sessions.
     */
    updateDeviceInputs() {
        var _a, _b, _c, _d, _e;
        // activeInputs already applies visibility, the primary input mode, and
        // per-input connectedness, exactly as the emulated frame loop does.
        for (const input of this.device.activeInputs) {
            // Through the input's own hook rather than the matrix write it wraps:
            // gaze re-pins its viewer-relative origin there.
            input.updateTargetRaySpace();
            for (const button of (_b = (_a = input.inputSource.gamepad) === null || _a === void 0 ? void 0 : _a.buttons) !== null && _b !== void 0 ? _b : []) {
                if (button instanceof GamepadButton) {
                    // An immediate write already moved `value`, so the edge is measured
                    // from the value it replaced instead of from the new one.
                    button[P_GAMEPAD].lastFrameValue =
                        (_c = button[P_GAMEPAD].immediateTransitionFrom) !== null && _c !== void 0 ? _c : button[P_GAMEPAD].value;
                    button[P_GAMEPAD].immediateTransitionFrom = null;
                    if (button[P_GAMEPAD].pendingValue != null) {
                        button[P_GAMEPAD].value = button[P_GAMEPAD].pendingValue;
                        button[P_GAMEPAD].pendingValue = null;
                    }
                }
            }
            (_e = (_d = input).updateHandPose) === null || _e === void 0 ? void 0 : _e.call(_d);
        }
    }
    prepareFrameCallback(adapter, time, frame) {
        // A browser callback queued through the wrapper can outlive uninstall(),
        // or even fire after a later reinstall. It must still reach the application,
        // but the detached adapter must never re-patch host objects or mutate state.
        if (!this.installedState || adapter.ended) {
            return;
        }
        const isNewFrame = adapter.lastFrameTime !== time || adapter.lastPreparedFrame !== frame;
        if (this.options.mode === 'gaze-only' && isNewFrame) {
            // A preparation failure must not leave the last physical viewer pose
            // looking valid to a synthetic gaze query in the application callback.
            adapter.nativeViewerPoseValid = false;
        }
        try {
            if (isNewFrame) {
                // Instance-tier fallbacks live for one native frame. Reverting them at
                // the next timestamp keeps exact uninstall semantics without retaining
                // every frame/pose object on browsers that allocate them per frame.
                adapter.instancePatches.revert();
                this.epoch += 1;
            }
            this.frameSessions.set(frame, adapter);
            adapter.activeFrame = frame;
            this.ensureFramePatches(frame);
            this.tick(adapter, time, frame);
            if (this.unhealthyFrameAdapters.delete(adapter) &&
                this.unhealthyFrameAdapters.size === 0) {
                this.capabilityState.supported = true;
            }
            adapter.framePreparationFailures = 0;
        }
        catch (error) {
            if (this.options.mode === 'gaze-only') {
                adapter.nativeViewerPoseValid = false;
            }
            adapter.framePreparationFailures += 1;
            const failureCount = adapter.framePreparationFailures;
            if (failureCount >= FRAME_PREPARATION_FAILURE_THRESHOLD) {
                this.unhealthyFrameAdapters.add(adapter);
                this.capabilityState.supported = false;
            }
            try {
                if (failureCount === 1 ||
                    failureCount === FRAME_PREPARATION_FAILURE_THRESHOLD ||
                    failureCount === FRAME_PREPARATION_FINAL_DIAGNOSTIC_COUNT) {
                    this.note(`Native frame preparation failed ${failureCount} consecutive time${failureCount === 1 ? '' : 's'}; the application frame was preserved${failureCount >= FRAME_PREPARATION_FAILURE_THRESHOLD ? ' and the override was marked unsupported' : ''}: ${this.errorText(error)}`, `frame-preparation-failed-${failureCount}`);
                }
            }
            catch (_a) {
                // Never let diagnostics prevent the browser-owned application callback.
            }
        }
    }
    /**
     * Ends this session's ownership of the frame. WebXR marks an XRFrame inactive
     * as soon as its callback returns, so nothing may hand it to the application
     * (or query it) afterwards.
     */
    releaseFrameCallback(adapter, frame) {
        if (adapter.activeFrame === frame) {
            adapter.activeFrame = null;
        }
    }
    /**
     * The recording currently driving poses and inputs, or null when the device
     * state is authoritative. Stays non-null for the remainder of the native
     * frame in which the recording reached its final sample.
     */
    activePlayer() {
        if (this.playbackFrame) {
            return this.playbackFrame;
        }
        const player = this.device[P_DEVICE].actionPlayer;
        return player &&
            (player.playing || player[P_ACTION_PLAYER].manualFrameActive)
            ? player
            : null;
    }
    currentViewerSpace() {
        if (this.options.mode === 'gaze-only') {
            return this.device[P_DEVICE].viewerSpace;
        }
        const player = this.activePlayer();
        return player ? player.viewerSpace : this.device[P_DEVICE].viewerSpace;
    }
    refreshInputSources(adapter, dispatchChange) {
        const visible = adapter.session.visibilityState === 'visible';
        const next = this.options.mode === 'gaze-only' || visible
            ? this.expectedSources(adapter)
            : [];
        if (visible) {
            // A facade with queued events stays published until those events drain,
            // so a recording's edge is never delivered for an unpublished source.
            for (const retained of adapter.retainedSources) {
                if (!next.includes(retained)) {
                    next.push(retained);
                }
            }
        }
        else {
            // A session that is not visible receives no animation frame callbacks, so
            // the queue would never drain. Input is suspended anyway: drop it rather
            // than pin input sources the application must not observe.
            adapter.pendingEvents.length = 0;
            adapter.retainedSources.clear();
            for (const binding of adapter.bindingByFacade.values()) {
                binding.pendingActions.clear();
            }
        }
        const removed = adapter.sources.filter((source) => !next.includes(source));
        const added = next.filter((source) => !adapter.sources.includes(source));
        if (added.length === 0 && removed.length === 0) {
            return;
        }
        for (const source of removed) {
            const binding = adapter.bindingByFacade.get(source);
            if (!binding) {
                continue;
            }
            if (visible) {
                // A source that disappears while the session remains visible must
                // terminate its actions. A visibility loss instead clears them
                // silently: there is no active frame on which to deliver an end, and
                // delaying it until the source is re-added would create an orphan.
                for (const trigger of Array.from(binding.activeActions)) {
                    this.emitInputEvent(adapter, `${trigger}end`, source, false);
                }
            }
            this.clearActionState(binding);
            this.resetButtonBaseline(binding);
        }
        for (const source of added) {
            const binding = adapter.bindingByFacade.get(source);
            if (binding) {
                // Only the button-edge baseline is reset here. activeActions is left
                // alone: a recording can start an action in the same tick that first
                // publishes its source, and that action still has to be terminable.
                binding.activeButtons.clear();
                this.resetButtonBaseline(binding);
            }
        }
        if (visible &&
            removed.some((source) => { var _a; return ((_a = adapter.bindingByFacade.get(source)) === null || _a === void 0 ? void 0 : _a.kind) === 'gaze'; })) {
            this.releaseGazeCommitActions(adapter, next);
        }
        adapter.sources = Object.freeze([...next]);
        if (dispatchChange) {
            const announcedAdded = this.options.mode === 'gaze-only'
                ? added.filter((source) => adapter.bindingByFacade.has(source))
                : added;
            const announcedRemoved = this.options.mode === 'gaze-only'
                ? removed.filter((source) => adapter.bindingByFacade.has(source))
                : removed;
            if (announcedAdded.length > 0 || announcedRemoved.length > 0) {
                this.dispatchInputSourcesChange(adapter, announcedAdded, announcedRemoved);
            }
        }
    }
    expectedSources(adapter) {
        if (this.options.mode === 'gaze-only') {
            const nativeSources = this.readNativeInputSources(adapter);
            const gaze = adapter.session.visibilityState === 'visible'
                ? this.connectedSources(adapter, 'gaze')
                : [];
            return [
                ...nativeSources,
                ...gaze.filter((source) => !nativeSources.includes(source)),
            ];
        }
        const player = this.activePlayer();
        if (player) {
            try {
                return player.inputSources.map((source) => this.playbackBinding(adapter, source).inputSource);
            }
            catch (error) {
                // refreshInputSources also runs outside the frame loop, so a failed
                // binding must degrade to "no sources" instead of escaping.
                this.note(`Recorded input sources could not be published: ${this.errorText(error)}`, 'recorded-input-publication-failed');
                return [];
            }
        }
        const kind = this.device.primaryInputMode;
        // Gaze is additive: it accompanies whichever primary input mode is
        // selected, and survives a mode that cannot publish anything at all.
        const gaze = this.connectedSources(adapter, 'gaze');
        if (kind === 'hand' && !adapter.handTracking) {
            this.note(`Native hand input requires the "${HAND_TRACKING_FEATURE}" feature on the browser session; no synthetic hand input sources are published while hand mode is selected.`);
            return gaze;
        }
        return [...this.connectedSources(adapter, kind), ...gaze];
    }
    readNativeInputSources(adapter) {
        if (!adapter.nativeInputSourcesLive) {
            return Array.from(adapter.nativeSources);
        }
        try {
            const sources = Array.from(adapter.nativeInputSources());
            adapter.nativeSources = Object.freeze([...sources]);
            return sources;
        }
        catch (error) {
            this.note(`Native input sources could not be read; preserving the last known set: ${this.errorText(error)}`, 'gaze-only-native-input-sources-unavailable');
            return adapter.sources.filter((source) => !adapter.bindingByFacade.has(source));
        }
    }
    /**
     * Ends the select actions that were committed against a gaze target ray.
     *
     * Gaze carries the aim and a separate source carries the commit, so a gaze
     * source that disappears mid-press would otherwise leave the application
     * holding an interaction it can no longer point. Squeeze is untouched: it is
     * not part of the gaze-plus-pinch contract and stays with its own source.
     */
    releaseGazeCommitActions(adapter, published) {
        // The buttons are shared with every other live session, so only the
        // current shared-state driver may zero them.
        const clearsSharedInputState = adapter === this.sharedStateDriver();
        for (const binding of adapter.deviceBindings) {
            if (binding.kind === 'gaze' || !published.includes(binding.inputSource)) {
                continue;
            }
            const selectButtons = binding.eventButtons.filter((button) => button[P_GAMEPAD].eventTrigger === 'select');
            if (selectButtons.length === 0) {
                continue;
            }
            if (binding.activeActions.has('select')) {
                this.emitInputEvent(adapter, 'selectend', binding.inputSource, false);
                binding.activeActions.delete('select');
            }
            binding.pendingActions.delete('select');
            for (const button of selectButtons) {
                binding.activeButtons.delete(button);
                if (clearsSharedInputState) {
                    this.releaseButton(button);
                }
                binding.previousButtonValues.set(button, button.value);
            }
        }
    }
    /** Drops a shared device button back to a fully released, edge-free state. */
    releaseButton(button) {
        button[P_GAMEPAD].value = 0;
        button[P_GAMEPAD].pendingValue = 0;
        button[P_GAMEPAD].lastFrameValue = 0;
        button[P_GAMEPAD].immediateTransitionFrom = null;
    }
    connectedSources(adapter, kind) {
        return adapter.deviceBindings
            .filter((binding) => binding.kind === kind && binding.trackedInput.connected)
            .map((binding) => binding.inputSource);
    }
    dispatchButtonTransitions(adapter, frame) {
        var _a;
        const visibleSources = new Set(adapter.sources);
        for (const binding of adapter.deviceBindings) {
            if (!visibleSources.has(binding.inputSource)) {
                continue;
            }
            for (const button of binding.eventButtons) {
                const previous = (_a = binding.previousButtonValues.get(button)) !== null && _a !== void 0 ? _a : 0;
                const current = button.value;
                binding.previousButtonValues.set(button, current);
                const trigger = button[P_GAMEPAD].eventTrigger;
                if (!trigger) {
                    continue;
                }
                if (previous === 0 && current > 0) {
                    binding.activeButtons.add(button);
                    this.dispatchInputEvent(adapter, `${trigger}start`, frame, binding.inputSource);
                }
                else if (previous > 0 && current === 0) {
                    if (binding.activeButtons.delete(button)) {
                        this.dispatchInputEvent(adapter, trigger, frame, binding.inputSource);
                        this.dispatchInputEvent(adapter, `${trigger}end`, frame, binding.inputSource);
                    }
                }
            }
        }
    }
    // ===========================================================================
    // Action playback routing
    // ===========================================================================
    /**
     * Attaches an event context so ActionPlayer's own select/squeeze edge
     * detection (including edges skipped across multi-frame advances) is routed
     * through the stable native facades instead of IWER's emulated session.
     */
    wirePlayer(player) {
        if (this.wiredPlayer === player) {
            return;
        }
        this.unwirePlayer();
        this.previousPlayerContext = player[P_ACTION_PLAYER].eventContext;
        const owner = this;
        // The player targets IWER's emulated session type; this relay accepts its
        // events and republishes them as native, facade-addressed events instead.
        const relay = {
            dispatchEvent(event) {
                owner.forwardPlaybackEvent(event);
                return true;
            },
        };
        player.setEventContext({
            session: relay,
            // ActionPlayer skips edge detection entirely when this yields nothing, so
            // never return null: an application-driven stepFrames() runs outside any
            // animation frame callback and its edges must still reach the queue.
            // The override re-stamps each event with a real frame as it drains.
            getFrame: () => { var _a, _b; return (_b = (_a = this.primarySession) === null || _a === void 0 ? void 0 : _a.activeFrame) !== null && _b !== void 0 ? _b : this.detachedPlaybackFrame; },
            onDiscontinuity: () => {
                owner.terminatePlaybackActions();
            },
        });
        this.wiredPlayer = player;
    }
    unwirePlayer() {
        const player = this.wiredPlayer;
        if (!player) {
            return;
        }
        this.wiredPlayer = null;
        const previous = this.previousPlayerContext;
        this.previousPlayerContext = undefined;
        try {
            player.setEventContext(previous);
        }
        catch (_a) {
            // Restoring diagnostics must never break teardown.
        }
    }
    /**
     * Translates one ActionPlayer edge into WebXR's native event order and queues
     * it on every live session.
     *
     * ActionPlayer emits `<trigger>` + `<trigger>start` when a recorded button
     * goes down and `<trigger>end` when it comes back up. That order is IWER's
     * long-standing emulated behavior and is left untouched for the emulated
     * runtime, but WebXR specifies `<trigger>start` on press and `<trigger>` +
     * `<trigger>end` on release. On a browser-owned session the application is
     * entitled to the specified order, and to the same order the override
     * already produces for live device input, so the press-time completion event
     * is dropped and reissued on release.
     */
    forwardPlaybackEvent(event) {
        const recorded = event.inputSource;
        if (!recorded) {
            return;
        }
        const type = event.type;
        const trigger = type.startsWith('select')
            ? 'select'
            : type.startsWith('squeeze')
                ? 'squeeze'
                : null;
        if (!trigger) {
            return;
        }
        const suffix = type.slice(trigger.length);
        if (suffix !== '' && suffix !== 'start' && suffix !== 'end') {
            return;
        }
        if (suffix === '') {
            // The player's press-time completion event; release reissues it in order.
            return;
        }
        for (const adapter of this.liveSessions) {
            let binding;
            try {
                binding = this.playbackBinding(adapter, recorded);
            }
            catch (error) {
                this.note(`A recorded input event could not be bound to a native input source: ${this.errorText(error)}`, 'recorded-input-binding-failed');
                continue;
            }
            if (suffix === 'start') {
                // Defensively close a held action before accepting another start. The
                // player's discontinuity hook normally does this at loop/seek time.
                this.terminatePlaybackAction(adapter, binding, trigger);
                binding.pendingActions.add(trigger);
                this.emitInputEvent(adapter, `${trigger}start`, binding.inputSource, true);
            }
            else {
                // Only terminate an action this session actually observed starting.
                if (!binding.pendingActions.delete(trigger)) {
                    continue;
                }
                this.emitInputEvent(adapter, trigger, binding.inputSource, true);
                this.emitInputEvent(adapter, `${trigger}end`, binding.inputSource, true);
            }
        }
    }
    terminatePlaybackActions() {
        for (const adapter of this.liveSessions) {
            for (const binding of adapter.playbackBindings.values()) {
                for (const trigger of new Set([
                    ...binding.pendingActions,
                    ...binding.activeActions,
                ])) {
                    this.terminatePlaybackAction(adapter, binding, trigger);
                }
            }
        }
    }
    terminatePlaybackAction(adapter, binding, trigger) {
        const wasPending = binding.pendingActions.delete(trigger);
        if (!wasPending && !binding.activeActions.has(trigger)) {
            return;
        }
        const endType = `${trigger}end`;
        const alreadyQueued = adapter.pendingEvents.some((event) => event.inputSource === binding.inputSource && event.type === endType);
        if (!alreadyQueued) {
            // A discontinuity interrupts rather than completes the action, so it
            // produces only the terminal event.
            this.emitInputEvent(adapter, endType, binding.inputSource, true);
        }
    }
    /**
     * Dispatches an input event immediately when this session owns an active
     * frame, and otherwise queues it for the session's next animation frame
     * callback. `retain` keeps the source published until the queue drains.
     */
    emitInputEvent(adapter, type, inputSource, retain) {
        const frame = adapter.activeFrame;
        if (frame && adapter.sources.includes(inputSource)) {
            this.dispatchInputEvent(adapter, type, frame, inputSource);
            return;
        }
        if (adapter.pendingEvents.length >= MAX_PENDING_EVENTS) {
            this.compactPendingEvents(adapter);
        }
        adapter.pendingEvents.push({ type, inputSource });
        if (retain) {
            adapter.retainedSources.add(inputSource);
        }
    }
    /**
     * Drops the oldest complete queued action lifecycle under backpressure.
     * Incomplete lifecycles are retained even past the soft limit: preserving
     * WebXR's start/end invariant is more important than a strict queue bound.
     */
    compactPendingEvents(adapter) {
        const starts = new Map();
        let lifecycle;
        for (let index = 0; index < adapter.pendingEvents.length; index++) {
            const event = adapter.pendingEvents[index];
            if (event.type.endsWith('start')) {
                const trigger = event.type.slice(0, -'start'.length);
                let byTrigger = starts.get(event.inputSource);
                if (!byTrigger) {
                    byTrigger = new Map();
                    starts.set(event.inputSource, byTrigger);
                }
                if (!byTrigger.has(trigger)) {
                    byTrigger.set(trigger, index);
                }
                continue;
            }
            if (!event.type.endsWith('end')) {
                continue;
            }
            const trigger = event.type.slice(0, -'end'.length);
            const byTrigger = starts.get(event.inputSource);
            const startIndex = byTrigger === null || byTrigger === void 0 ? void 0 : byTrigger.get(trigger);
            if (startIndex === undefined) {
                continue;
            }
            byTrigger.delete(trigger);
            if (!lifecycle || startIndex < lifecycle.startIndex) {
                lifecycle = {
                    startIndex,
                    endIndex: index,
                    inputSource: event.inputSource,
                    trigger,
                };
            }
        }
        if (!lifecycle) {
            return;
        }
        const { startIndex, endIndex, inputSource, trigger } = lifecycle;
        const startType = `${trigger}start`;
        const endType = `${trigger}end`;
        adapter.pendingEvents = adapter.pendingEvents.filter((event, index) => index < startIndex ||
            index > endIndex ||
            event.inputSource !== inputSource ||
            (event.type !== trigger &&
                event.type !== startType &&
                event.type !== endType));
        this.note('A native session fell too far behind; an oldest complete queued input action was discarded.');
    }
    /** Flushes queued input events with a frame this session currently owns. */
    drainPendingEvents(adapter, frame) {
        if (adapter.pendingEvents.length === 0) {
            adapter.retainedSources.clear();
            return;
        }
        const queued = adapter.pendingEvents.splice(0);
        adapter.retainedSources.clear();
        for (const entry of queued) {
            this.dispatchInputEvent(adapter, entry.type, frame, entry.inputSource);
        }
    }
    dispatchInputEvent(adapter, type, frame, inputSource) {
        // Record the transition before dispatching: a listener may synchronously
        // remove the source, and the terminating event must be based on what the
        // application has been told by then.
        this.recordDeliveredAction(adapter, type, inputSource);
        const event = this.createEvent(type, 'XRInputSourceEvent', {
            frame,
            inputSource,
        });
        this.syntheticEvents.add(event);
        adapter.session.dispatchEvent(event);
    }
    /**
     * Tracks which actions the application currently believes are in progress.
     * Only delivered events count, so an event dropped while a session was not
     * visible can never produce an unmatched terminating event later.
     */
    recordDeliveredAction(adapter, type, inputSource) {
        const binding = adapter.bindingByFacade.get(inputSource);
        if (!binding) {
            return;
        }
        if (type.endsWith('start')) {
            binding.activeActions.add(type.slice(0, -'start'.length));
        }
        else if (type.endsWith('end')) {
            binding.activeActions.delete(type.slice(0, -'end'.length));
        }
    }
    dispatchInputSourcesChange(adapter, added, removed) {
        const event = this.createEvent('inputsourceschange', 'XRInputSourcesChangeEvent', {
            session: adapter.session,
            added: Object.freeze([...added]),
            removed: Object.freeze([...removed]),
        });
        this.syntheticEvents.add(event);
        adapter.session.dispatchEvent(event);
    }
    createEvent(type, prototypeName, properties) {
        const EventConstructor = eventConstructor(this.globalObject);
        if (!EventConstructor) {
            throw new Error('Event constructor is unavailable.');
        }
        const event = new EventConstructor(type);
        const prototype = this.constructorPrototype(prototypeName);
        if (prototype) {
            try {
                Object.setPrototypeOf(event, prototype);
                if (prototypeName === 'XRInputSourceEvent') {
                    this.capabilityState.brandedInputEvents = true;
                }
            }
            catch (_a) {
                // A standards-shaped Event with own data properties remains usable.
            }
        }
        for (const [key, value] of Object.entries(properties)) {
            Object.defineProperty(event, key, {
                configurable: true,
                enumerable: true,
                value,
            });
        }
        return event;
    }
    // ===========================================================================
    // Frame patches
    // ===========================================================================
    ensureFramePatches(frame) {
        var _a, _b, _c;
        if (this.instancePatchedFrameEpochs.get(frame) === this.epoch) {
            return;
        }
        const adapter = this.adapterForFrame(frame);
        const posePatched = this.patchFrameGetPose(frame);
        const batchPatched = this.patchFrameFillPoses(frame);
        const full = this.options.mode === 'full';
        const viewerPatched = full ? this.patchFrameGetViewerPose(frame) : false;
        const jointPatched = full ? this.patchFrameGetJointPose(frame) : false;
        const radiiPatched = full ? this.patchFrameFillJointRadii(frame) : false;
        if (adapter && full) {
            this.recordAnchorAvailability(adapter, this.patchFrameCreateAnchor(frame));
            this.recordHitTestAvailability(adapter, this.patchFrameGetHitTestResults(frame));
        }
        (_a = this.capabilityState).poseOverride || (_a.poseOverride = posePatched);
        (_b = this.capabilityState).batchPoses || (_b.batchPoses = batchPatched);
        (_c = this.capabilityState).jointPoses || (_c.jointPoses = full && jointPatched && radiiPatched);
        if (!posePatched) {
            this.note('Unable to patch native XRFrame.getPose.');
        }
        if (!batchPatched) {
            this.note('Unable to patch native XRFrame.fillPoses.');
        }
        if (full && !viewerPatched) {
            this.note('Unable to patch native XRFrame.getViewerPose.');
        }
        this.instancePatchedFrameEpochs.set(frame, this.epoch);
    }
    patchFrameGetPose(frame) {
        const found = methodDescriptor(frame, 'getPose');
        if (found &&
            found.owner !== frame &&
            this.patchedFrameOwners.has(found.owner)) {
            return true;
        }
        const nativeMethod = found === null || found === void 0 ? void 0 : found.descriptor.value;
        if (!found || typeof nativeMethod !== 'function') {
            return false;
        }
        const owner = this;
        if (found.owner !== frame) {
            this.rawGetPoseByOwner.set(found.owner, nativeMethod);
            const patched = this.patches.define(found.owner, 'getPose', {
                ...found.descriptor,
                value(space, baseSpace) {
                    return owner.handleGetPose(this, nativeMethod, space, baseSpace);
                },
            });
            if (patched) {
                this.patchedFrameOwners.add(found.owner);
                return true;
            }
        }
        this.rawGetPoseByFrame.set(frame, nativeMethod);
        return this.defineFrameMethod(frame, 'getPose', function (space, baseSpace) {
            return owner.handleGetPose(this, nativeMethod, space, baseSpace);
        });
    }
    patchFrameGetViewerPose(frame) {
        const found = methodDescriptor(frame, 'getViewerPose');
        if (found &&
            found.owner !== frame &&
            this.patchedViewerFrameOwners.has(found.owner)) {
            return true;
        }
        const nativeMethod = found === null || found === void 0 ? void 0 : found.descriptor.value;
        if (!found || typeof nativeMethod !== 'function') {
            return false;
        }
        const owner = this;
        if (found.owner !== frame) {
            const patched = this.patches.define(found.owner, 'getViewerPose', {
                ...found.descriptor,
                value(referenceSpace) {
                    return owner.handleGetViewerPose(this, nativeMethod, referenceSpace);
                },
            });
            if (patched) {
                this.patchedViewerFrameOwners.add(found.owner);
                return true;
            }
        }
        return this.defineFrameMethod(frame, 'getViewerPose', function (referenceSpace) {
            return owner.handleGetViewerPose(this, nativeMethod, referenceSpace);
        });
    }
    patchFrameFillPoses(frame) {
        const found = methodDescriptor(frame, 'fillPoses');
        if (found &&
            found.owner !== frame &&
            this.patchedFillPosesOwners.has(found.owner)) {
            return true;
        }
        const nativeMethod = found === null || found === void 0 ? void 0 : found.descriptor.value;
        if (!found || typeof nativeMethod !== 'function') {
            return false;
        }
        const owner = this;
        if (found.owner !== frame) {
            const patched = this.patches.define(found.owner, 'fillPoses', {
                ...found.descriptor,
                value(spaces, baseSpace, transforms) {
                    return owner.handleFillPoses(this, nativeMethod, spaces, baseSpace, transforms);
                },
            });
            if (patched) {
                this.patchedFillPosesOwners.add(found.owner);
                return true;
            }
        }
        return this.defineFrameMethod(frame, 'fillPoses', function (spaces, baseSpace, transforms) {
            return owner.handleFillPoses(this, nativeMethod, spaces, baseSpace, transforms);
        });
    }
    patchFrameGetJointPose(frame) {
        const found = methodDescriptor(frame, 'getJointPose');
        if (found &&
            found.owner !== frame &&
            this.patchedJointPoseOwners.has(found.owner)) {
            return true;
        }
        const nativeMethod = found === null || found === void 0 ? void 0 : found.descriptor.value;
        if (!found || typeof nativeMethod !== 'function') {
            return false;
        }
        const owner = this;
        if (found.owner !== frame) {
            const patched = this.patches.define(found.owner, 'getJointPose', {
                ...found.descriptor,
                value(joint, baseSpace) {
                    return owner.handleGetJointPose(this, nativeMethod, joint, baseSpace);
                },
            });
            if (patched) {
                this.patchedJointPoseOwners.add(found.owner);
                return true;
            }
        }
        return this.defineFrameMethod(frame, 'getJointPose', function (joint, baseSpace) {
            return owner.handleGetJointPose(this, nativeMethod, joint, baseSpace);
        });
    }
    patchFrameFillJointRadii(frame) {
        const found = methodDescriptor(frame, 'fillJointRadii');
        if (found &&
            found.owner !== frame &&
            this.patchedJointRadiiOwners.has(found.owner)) {
            return true;
        }
        const nativeMethod = found === null || found === void 0 ? void 0 : found.descriptor.value;
        if (!found || typeof nativeMethod !== 'function') {
            return false;
        }
        const owner = this;
        if (found.owner !== frame) {
            const patched = this.patches.define(found.owner, 'fillJointRadii', {
                ...found.descriptor,
                value(jointSpaces, radii) {
                    return owner.handleFillJointRadii(this, nativeMethod, jointSpaces, radii);
                },
            });
            if (patched) {
                this.patchedJointRadiiOwners.add(found.owner);
                return true;
            }
        }
        return this.defineFrameMethod(frame, 'fillJointRadii', function (jointSpaces, radii) {
            return owner.handleFillJointRadii(this, nativeMethod, jointSpaces, radii);
        });
    }
    patchFrameCreateAnchor(frame) {
        const found = methodDescriptor(frame, 'createAnchor');
        if (found &&
            found.owner !== frame &&
            this.patchedCreateAnchorOwners.has(found.owner)) {
            return 'patched';
        }
        const nativeMethod = found === null || found === void 0 ? void 0 : found.descriptor.value;
        if (!found || typeof nativeMethod !== 'function') {
            return 'unavailable';
        }
        const owner = this;
        const wrapped = function (pose, space) {
            return owner.handleCreateAnchor(this, nativeMethod, pose, space);
        };
        if (found.owner !== frame) {
            const patched = this.patches.define(found.owner, 'createAnchor', {
                ...found.descriptor,
                value: wrapped,
            });
            if (patched) {
                this.patchedCreateAnchorOwners.add(found.owner);
                return 'patched';
            }
        }
        return this.defineFrameMethod(frame, 'createAnchor', wrapped)
            ? 'patched'
            : 'failed';
    }
    patchFrameGetHitTestResults(frame) {
        const found = methodDescriptor(frame, 'getHitTestResults');
        if (found &&
            found.owner !== frame &&
            this.patchedHitTestResultOwners.has(found.owner)) {
            return 'patched';
        }
        const nativeMethod = found === null || found === void 0 ? void 0 : found.descriptor.value;
        if (!found || typeof nativeMethod !== 'function') {
            return 'unavailable';
        }
        const owner = this;
        const wrapped = function (hitTestSource) {
            return owner.handleGetHitTestResults(this, nativeMethod, hitTestSource);
        };
        if (found.owner !== frame) {
            const patched = this.patches.define(found.owner, 'getHitTestResults', {
                ...found.descriptor,
                value: wrapped,
            });
            if (patched) {
                this.patchedHitTestResultOwners.add(found.owner);
                return 'patched';
            }
        }
        return this.defineFrameMethod(frame, 'getHitTestResults', wrapped)
            ? 'patched'
            : 'failed';
    }
    /**
     * Records whether XRFrame.createAnchor can be intercepted. Without the
     * interception an IWER-controlled space would reach the browser untranslated
     * and silently anchor at the wrong origin, so the capability is reported and
     * controlled spaces are refused instead.
     */
    recordAnchorAvailability(adapter, outcome) {
        if (outcome === 'unavailable') {
            return;
        }
        adapter.createAnchorAvailable = outcome === 'patched';
        if (outcome === 'failed') {
            this.note('Unable to override XRFrame.createAnchor on a native frame; anchors in IWER-controlled spaces are unavailable until a frame can be instrumented.');
        }
    }
    /**
     * Records whether XRFrame.getHitTestResults can be intercepted. Without it
     * the hit test facade would reach the browser as a foreign object, so the
     * capability is reported and controlled spaces are refused for this session.
     */
    recordHitTestAvailability(adapter, outcome) {
        if (outcome === 'unavailable') {
            return;
        }
        adapter.hitTestResultsAvailable = outcome === 'patched';
        if (outcome === 'failed') {
            this.note('Unable to override XRFrame.getHitTestResults on a native frame; hit test sources in IWER-controlled spaces are unavailable until a frame can be instrumented.');
        }
    }
    defineFrameMethod(frame, key, value) {
        const adapter = this.adapterForFrame(frame);
        if (!adapter) {
            return false;
        }
        return adapter.instancePatches.define(frame, key, {
            configurable: true,
            writable: true,
            value,
        });
    }
    // ===========================================================================
    // Pose resolution
    // ===========================================================================
    handleGetPose(frame, nativeMethod, space, baseSpace) {
        if (!this.installedState) {
            return nativeMethod.call(frame, space, baseSpace);
        }
        const spaceInfo = this.spaces.get(space);
        const baseInfo = this.spaces.get(baseSpace);
        const involvesControlledSpace = Boolean(spaceInfo || baseInfo);
        if (!involvesControlledSpace) {
            return nativeMethod.call(frame, space, baseSpace);
        }
        const adapter = this.adapterForFrame(frame);
        if (!adapter) {
            throw invalidState('The IWER-controlled space was queried from a frame owned by another native session.');
        }
        this.assertFrameActive(adapter, frame, 'getPose');
        if ((spaceInfo && spaceInfo.adapter !== adapter) ||
            (baseInfo && baseInfo.adapter !== adapter)) {
            throw invalidState('The IWER-controlled space belongs to a different native session.');
        }
        if (((spaceInfo === null || spaceInfo === void 0 ? void 0 : spaceInfo.available) && !spaceInfo.available()) ||
            ((baseInfo === null || baseInfo === void 0 ? void 0 : baseInfo.available) && !baseInfo.available())) {
            return null;
        }
        const matrix = this.effectivePoseMatrix(adapter, frame, nativeMethod, space, baseSpace);
        if (!matrix) {
            this.note('A synthetic pose could not be resolved in the requested base space.');
            return null;
        }
        this.capabilityState.phase = 'active';
        return this.createPoseFacade(matrix);
    }
    handleGetJointPose(frame, nativeMethod, joint, baseSpace) {
        if (!this.installedState) {
            return nativeMethod.call(frame, joint, baseSpace);
        }
        const jointInfo = this.spaces.get(joint);
        const baseInfo = this.spaces.get(baseSpace);
        if (!jointInfo && !baseInfo) {
            return nativeMethod.call(frame, joint, baseSpace);
        }
        if (jointInfo && !jointInfo.joint) {
            // WebIDL rejects a non-XRJointSpace argument before the method runs.
            throw new TypeError("Failed to execute 'getJointPose' on 'XRFrame': parameter 1 is not of type 'XRJointSpace'.");
        }
        const adapter = this.adapterForFrame(frame);
        if (!adapter) {
            throw invalidState('The IWER-controlled joint space was queried from a frame owned by another native session.');
        }
        this.assertFrameActive(adapter, frame, 'getJointPose');
        if ((jointInfo && jointInfo.adapter !== adapter) ||
            (baseInfo && baseInfo.adapter !== adapter)) {
            throw invalidState('The IWER-controlled joint space belongs to a different native session.');
        }
        const rawGetPose = this.nativeGetPose(frame);
        if (!rawGetPose) {
            this.note('The native XRFrame.getPose implementation is unavailable.');
            return null;
        }
        let radius;
        if (jointInfo === null || jointInfo === void 0 ? void 0 : jointInfo.joint) {
            radius = jointInfo.joint.source[P_JOINT_SPACE].radius;
            // An unknown radius means the joint is not tracked this frame, which
            // WebXR Hand Input reports as a null pose (and as NaN in fillJointRadii).
            if (!isTrackedRadius(radius)) {
                return null;
            }
        }
        else {
            // Mixed query: a browser-tracked joint resolved against a synthetic base
            // space still reports the browser's radius.
            const nativePose = nativeMethod.call(frame, joint, adapter.anchorSpace);
            if (!nativePose) {
                return nativePose;
            }
            radius = nativePose.radius;
        }
        const matrix = this.effectivePoseMatrix(adapter, frame, rawGetPose, joint, baseSpace, true);
        if (!matrix) {
            this.note('A synthetic joint pose could not be resolved in the requested base space.');
            return null;
        }
        return this.createJointPoseFacade(matrix, radius);
    }
    handleFillJointRadii(frame, nativeMethod, jointSpaces, radii) {
        const spaces = Array.from(jointSpaces);
        if (!this.installedState) {
            return nativeMethod.call(frame, spaces, radii);
        }
        if (!spaces.some((space) => this.spaces.has(space))) {
            return nativeMethod.call(frame, spaces, radii);
        }
        // WebIDL converts every sequence element before the frame algorithm runs.
        // Mirror that ordering for synthetic spaces, even on an inactive frame.
        for (const space of spaces) {
            const info = this.spaces.get(space);
            if (info && !info.joint) {
                throw new TypeError("Failed to execute 'fillJointRadii' on 'XRFrame': an element of jointSpaces is not of type 'XRJointSpace'.");
            }
        }
        const adapter = this.adapterForFrame(frame);
        if (!adapter) {
            throw invalidState('IWER-controlled joint radii were queried from a frame owned by another native session.');
        }
        this.assertFrameActive(adapter, frame, 'fillJointRadii');
        for (const space of spaces) {
            const info = this.spaces.get(space);
            if (info && info.adapter !== adapter) {
                throw invalidState('An IWER-controlled joint space belongs to a different native session.');
            }
        }
        if (spaces.length > radii.length) {
            throw new TypeError('The length of jointSpaces is larger than the number of elements in radii.');
        }
        let allValid = true;
        for (let index = 0; index < spaces.length; index++) {
            const info = this.spaces.get(spaces[index]);
            if ((info === null || info === void 0 ? void 0 : info.joint) && info.adapter === adapter) {
                const radius = info.joint.source[P_JOINT_SPACE].radius;
                if (isTrackedRadius(radius)) {
                    radii[index] = radius;
                }
                else {
                    radii[index] = NaN;
                    allValid = false;
                }
            }
            else {
                // Browser-tracked joints keep native semantics, including any error the
                // native implementation raises for this frame.
                const valid = nativeMethod.call(frame, [spaces[index]], scratchRadius);
                radii[index] = valid ? scratchRadius[0] : NaN;
                allValid && (allValid = valid);
            }
        }
        return allValid;
    }
    handleFillPoses(frame, nativeMethod, spaces, baseSpace, transforms) {
        const spaceList = Array.from(spaces);
        if (!this.installedState) {
            return nativeMethod.call(frame, spaceList, baseSpace, transforms);
        }
        const baseInfo = this.spaces.get(baseSpace);
        const hasOverride = Boolean(baseInfo) || spaceList.some((space) => this.spaces.has(space));
        if (!hasOverride) {
            return nativeMethod.call(frame, spaceList, baseSpace, transforms);
        }
        const adapter = this.adapterForFrame(frame);
        if (!adapter) {
            throw invalidState('IWER-controlled poses were queried from a frame owned by another native session.');
        }
        this.assertFrameActive(adapter, frame, 'fillPoses');
        if ((baseInfo && baseInfo.adapter !== adapter) ||
            spaceList.some((space) => {
                const info = this.spaces.get(space);
                return info != null && info.adapter !== adapter;
            })) {
            throw invalidState('An IWER-controlled space belongs to a different native session.');
        }
        if (transforms.length < spaceList.length * 16) {
            // WebXR specifies a TypeError for an output buffer that cannot hold one
            // 4x4 matrix per requested space.
            throw new TypeError('The length of transforms is too small to hold a transform for every space.');
        }
        const rawGetPose = this.nativeGetPose(frame);
        if (!rawGetPose) {
            return false;
        }
        let allValid = true;
        for (let index = 0; index < spaceList.length; index++) {
            const matrix = this.effectivePoseMatrix(adapter, frame, rawGetPose, spaceList[index], baseSpace, true);
            if (!matrix) {
                allValid = false;
                continue;
            }
            copyMatrixToArray(matrix, transforms, index * 16);
        }
        return allValid;
    }
    handleGetViewerPose(frame, nativeMethod, referenceSpace) {
        const nativePose = nativeMethod.call(frame, referenceSpace);
        const adapter = this.adapterForFrame(frame);
        if (!nativePose || !adapter || !this.installedState) {
            return nativePose;
        }
        const rawGetPose = this.nativeGetPose(frame);
        if (!rawGetPose) {
            return this.viewerOverrideFailure('The native XRFrame.getPose implementation could not be recovered.');
        }
        const overriddenViewer = this.viewerToBaseMatrix(adapter, frame, rawGetPose, referenceSpace);
        if (!overriddenViewer) {
            return this.viewerOverrideFailure('The overridden viewer pose could not be resolved in the requested reference space.');
        }
        const rawViewerTransform = this.readNativeTransform(nativePose);
        if (!rawViewerTransform) {
            return this.viewerOverrideFailure('The browser-owned XRViewerPose transform could not be read.');
        }
        const rawViewer = matrixFromTransform(rawViewerTransform);
        const overriddenObjects = [];
        if (!this.overrideTransform(adapter, nativePose, this.rigidTransformFromMatrix(overriddenViewer))) {
            return this.viewerOverrideFailure('The browser-owned XRViewerPose transform could not be overridden.');
        }
        overriddenObjects.push(nativePose);
        const inverseRawViewer = invert$1(scratchRelativeView, rawViewer);
        if (!inverseRawViewer) {
            this.clearTransformOverrides(overriddenObjects);
            return this.viewerOverrideFailure('The browser-owned XRViewerPose transform was not invertible.');
        }
        for (const view of nativePose.views) {
            const rawViewTransform = this.readNativeTransform(view);
            if (!rawViewTransform) {
                this.clearTransformOverrides(overriddenObjects);
                return this.viewerOverrideFailure('A browser-owned XRView transform could not be read.');
            }
            const rawView = matrixFromTransform(rawViewTransform);
            const relative = create$5();
            multiply$2(relative, inverseRawViewer, rawView);
            const overriddenView = create$5();
            multiply$2(overriddenView, overriddenViewer, relative);
            if (!this.overrideTransform(adapter, view, this.rigidTransformFromMatrix(overriddenView))) {
                this.clearTransformOverrides(overriddenObjects);
                return this.viewerOverrideFailure('A browser-owned XRView transform could not be overridden.');
            }
            overriddenObjects.push(view);
        }
        this.capabilityState.viewerPose = true;
        this.capabilityState.viewTransforms = true;
        this.capabilityState.phase = 'active';
        return nativePose;
    }
    viewerOverrideFailure(message) {
        this.note(message);
        return null;
    }
    effectivePoseMatrix(adapter, frame, nativeGetPose, space, baseSpace, includeNative = false) {
        const targetInfo = this.spaces.get(space);
        const baseInfo = this.spaces.get(baseSpace);
        if ((targetInfo && targetInfo.adapter !== adapter) ||
            (baseInfo && baseInfo.adapter !== adapter)) {
            return null;
        }
        if (!targetInfo && !baseInfo && !includeNative) {
            return null;
        }
        const targetToAnchor = targetInfo
            ? this.controlledSpaceToAnchor(targetInfo, scratchTargetMatrix)
            : this.nativePoseMatrix(nativeGetPose.call(frame, space, adapter.anchorSpace));
        if (!targetToAnchor) {
            return null;
        }
        let anchorToBase;
        if (baseInfo) {
            const baseToAnchor = this.controlledSpaceToAnchor(baseInfo, scratchBaseToAnchor);
            anchorToBase = baseToAnchor
                ? invert$1(scratchAnchorToBase, baseToAnchor)
                : null;
        }
        else {
            anchorToBase = this.anchorToNativeBase(adapter, frame, nativeGetPose, baseSpace);
        }
        if (!anchorToBase) {
            return null;
        }
        return clone(multiply$2(scratchResultMatrix, anchorToBase, targetToAnchor));
    }
    viewerToBaseMatrix(adapter, frame, nativeGetPose, baseSpace) {
        const viewerToAnchor = this.viewerMatrix(scratchViewerMatrix);
        const baseInfo = this.spaces.get(baseSpace);
        let anchorToBase;
        if (baseInfo) {
            if (baseInfo.adapter !== adapter) {
                return null;
            }
            const baseToAnchor = this.controlledSpaceToAnchor(baseInfo, scratchBaseToAnchor);
            anchorToBase = baseToAnchor
                ? invert$1(scratchAnchorToBase, baseToAnchor)
                : null;
        }
        else {
            anchorToBase = this.anchorToNativeBase(adapter, frame, nativeGetPose, baseSpace);
        }
        if (!anchorToBase) {
            return null;
        }
        return clone(multiply$2(scratchResultMatrix, anchorToBase, viewerToAnchor));
    }
    controlledSpaceToAnchor(info, output) {
        if (info.available && !info.available()) {
            return null;
        }
        if (!info.origin) {
            identity(output);
        }
        else {
            const source = info.origin();
            if (!source) {
                return null;
            }
            XRSpaceUtils.calculateGlobalOffsetMatrix(source, output);
        }
        multiply$2(output, output, info.localOffset);
        return output;
    }
    viewerMatrix(output) {
        return XRSpaceUtils.calculateGlobalOffsetMatrix(this.currentViewerSpace(), output);
    }
    anchorToNativeBase(adapter, frame, nativeGetPose, baseSpace) {
        if (adapter.baseSpaceCache.has(baseSpace)) {
            const cached = adapter.baseSpaceCache.get(baseSpace);
            return cached ? clone(cached) : null;
        }
        const pose = nativeGetPose.call(frame, adapter.anchorSpace, baseSpace);
        const matrix = this.nativePoseMatrix(pose);
        adapter.baseSpaceCache.set(baseSpace, matrix ? clone(matrix) : null);
        return matrix;
    }
    nativePoseMatrix(pose) {
        if (!pose) {
            return null;
        }
        const transform = this.readNativeTransform(pose);
        return transform ? matrixFromTransform(transform) : null;
    }
    createPoseFacade(matrix) {
        const prototype = this.constructorPrototype('XRPose');
        const pose = Object.create(prototype !== null && prototype !== void 0 ? prototype : Object.prototype);
        Object.defineProperties(pose, this.poseProperties(matrix));
        return pose;
    }
    createJointPoseFacade(matrix, radius) {
        var _a;
        const prototype = (_a = this.constructorPrototype('XRJointPose')) !== null && _a !== void 0 ? _a : this.constructorPrototype('XRPose');
        const pose = Object.create(prototype !== null && prototype !== void 0 ? prototype : Object.prototype);
        Object.defineProperties(pose, {
            ...this.poseProperties(matrix),
            radius: { configurable: true, enumerable: true, value: radius },
        });
        return pose;
    }
    poseProperties(matrix) {
        return {
            transform: {
                configurable: true,
                enumerable: true,
                value: this.rigidTransformFromMatrix(matrix),
            },
            emulatedPosition: {
                configurable: true,
                enumerable: true,
                value: false,
            },
            linearVelocity: {
                configurable: true,
                enumerable: true,
                value: null,
            },
            angularVelocity: {
                configurable: true,
                enumerable: true,
                value: null,
            },
        };
    }
    rigidTransformFromMatrix(matrix) {
        getTranslation(scratchPosition, matrix);
        getRotation(scratchOrientation, matrix);
        return new (this.getRigidTransformConstructor())({
            x: scratchPosition[0],
            y: scratchPosition[1],
            z: scratchPosition[2],
            w: 1,
        }, {
            x: scratchOrientation[0],
            y: scratchOrientation[1],
            z: scratchOrientation[2],
            w: scratchOrientation[3],
        });
    }
    getRigidTransformConstructor() {
        const constructor = globalRecord(this.globalObject).XRRigidTransform;
        if (typeof constructor !== 'function') {
            throw new Error('Native XRRigidTransform constructor is unavailable.');
        }
        return constructor;
    }
    readNativeTransform(object) {
        let reader = this.transformReaders.get(object);
        if (!reader) {
            const found = methodDescriptor(object, 'transform');
            if (!found) {
                return null;
            }
            let nativeGetter = this.rawTransformGetters.get(found.owner);
            if (!nativeGetter && found.descriptor.get) {
                nativeGetter = found.descriptor.get;
                this.rawTransformGetters.set(found.owner, nativeGetter);
            }
            if (nativeGetter) {
                reader = () => nativeGetter.call(object);
            }
            else if ('value' in found.descriptor) {
                const value = found.descriptor.value;
                reader = () => value;
            }
            else {
                return null;
            }
            this.transformReaders.set(object, reader);
        }
        try {
            return reader();
        }
        catch (_a) {
            return null;
        }
    }
    overrideTransform(adapter, object, transform) {
        const reader = this.readNativeTransform(object);
        if (!reader) {
            return false;
        }
        this.transformOverrides.set(object, { epoch: this.epoch, transform });
        const found = methodDescriptor(object, 'transform');
        if (!found) {
            return false;
        }
        if (found.owner !== object &&
            this.patchedTransformOwners.has(found.owner)) {
            return true;
        }
        const nativeGetter = this.rawTransformGetters.get(found.owner);
        if (found.owner !== object &&
            nativeGetter &&
            found.descriptor.configurable !== false) {
            const owner = this;
            const patched = this.patches.define(found.owner, 'transform', {
                ...found.descriptor,
                get() {
                    const current = owner.transformOverrides.get(this);
                    if (owner.installedState &&
                        current &&
                        current.epoch === owner.epoch) {
                        return current.transform;
                    }
                    return nativeGetter.call(this);
                },
            });
            if (patched) {
                this.patchedTransformOwners.add(found.owner);
                return true;
            }
        }
        if (this.instancePatchedTransformEpochs.get(object) === this.epoch) {
            return true;
        }
        const owner = this;
        const patched = adapter.instancePatches.define(object, 'transform', {
            configurable: true,
            get() {
                var _a;
                const current = owner.transformOverrides.get(this);
                if (owner.installedState && current && current.epoch === owner.epoch) {
                    return current.transform;
                }
                return (_a = owner.transformReaders.get(this)) === null || _a === void 0 ? void 0 : _a();
            },
        });
        if (patched) {
            this.instancePatchedTransformEpochs.set(object, this.epoch);
            return true;
        }
        this.transformOverrides.delete(object);
        return false;
    }
    clearTransformOverrides(objects) {
        for (const object of objects) {
            this.transformOverrides.delete(object);
        }
    }
    nativeGetPose(frame) {
        var _a;
        const direct = this.rawGetPoseByFrame.get(frame);
        if (direct) {
            return direct;
        }
        const found = methodDescriptor(frame, 'getPose');
        return found ? ((_a = this.rawGetPoseByOwner.get(found.owner)) !== null && _a !== void 0 ? _a : null) : null;
    }
    // ===========================================================================
    // Anchors
    // ===========================================================================
    handleCreateAnchor(frame, nativeMethod, pose, space) {
        if (!this.installedState) {
            return nativeMethod.call(frame, pose, space);
        }
        const info = this.spaces.get(space);
        if (!info) {
            return nativeMethod.call(frame, pose, space);
        }
        try {
            const adapter = this.adapterForFrame(frame);
            if (!adapter || adapter.ended) {
                throw invalidState('The IWER-controlled anchor space belongs to a different native session.');
            }
            this.assertFrameActive(adapter, frame, 'createAnchor');
            if (adapter !== info.adapter) {
                throw invalidState('The IWER-controlled anchor space belongs to a different native session.');
            }
            if (!adapter.createAnchorAvailable) {
                throw new DOMException('Anchors in IWER-controlled spaces are unavailable because XRFrame.createAnchor could not be overridden.', 'NotSupportedError');
            }
            const controlledToAnchor = this.controlledSpaceToAnchor(info, scratchControlledMatrix);
            if (!controlledToAnchor) {
                throw invalidState('The IWER-controlled anchor space could not be resolved for this frame.');
            }
            // anchorSpace_from_anchor = anchorSpace_from_controlled * controlled_from_anchor
            const composed = multiply$2(create$5(), controlledToAnchor, matrixFromTransform(pose));
            const translated = this.rigidTransformFromMatrix(composed);
            this.capabilityState.anchors = true;
            // Native feature errors and inactive-frame errors stay authoritative.
            return nativeMethod.call(frame, translated, adapter.anchorSpace);
        }
        catch (error) {
            // Promise-returning WebIDL operations report validation failures through
            // rejection rather than throwing synchronously.
            return Promise.reject(error);
        }
    }
    // ===========================================================================
    // Hit testing
    // ===========================================================================
    handleRequestHitTestSource(session, nativeMethod, options) {
        const info = this.installedState && options ? this.spaces.get(options.space) : null;
        if (!info) {
            return nativeMethod.call(session, options);
        }
        const adapter = this.sessionsByObject.get(session);
        if (!adapter || adapter !== info.adapter || adapter.ended) {
            return Promise.reject(invalidState('The IWER-controlled hit test space belongs to a different native session.'));
        }
        if (!adapter.hitTestResultsAvailable) {
            return Promise.reject(new DOMException('Hit test sources in IWER-controlled spaces are unavailable because XRFrame.getHitTestResults could not be overridden.', 'NotSupportedError'));
        }
        const matrix = this.controlledSpaceToAnchor(info, scratchHitTestMatrix);
        if (!matrix) {
            return Promise.reject(invalidState('The IWER-controlled hit test space could not be resolved.'));
        }
        const binding = {
            adapter,
            facade: undefined,
            space: options.space,
            // Copy the caller's dictionary: WebXR treats it as by-value, and it is
            // replayed on every resubscribe long after the call returns.
            requestedOptions: {
                ...options,
                entityTypes: options.entityTypes
                    ? Array.from(options.entityTypes)
                    : undefined,
            },
            nativeMethod,
            current: null,
            currentMatrix: null,
            pendingMatrix: null,
            pendingToken: 0,
            failures: 0,
            backoffFrames: 0,
            cancelled: false,
        };
        binding.facade = this.createHitTestSourceFacade(binding);
        adapter.hitTests.add(binding);
        this.hitTestBindings.set(binding.facade, binding);
        this.capabilityState.hitTest = true;
        return this.requestBackingSource(binding, matrix).then(() => binding.facade, (error) => {
            this.disposeHitTestBinding(binding);
            throw error;
        });
    }
    createHitTestSourceFacade(binding) {
        const prototype = this.constructorPrototype('XRHitTestSource');
        const facade = Object.create(prototype !== null && prototype !== void 0 ? prototype : Object.prototype);
        Object.defineProperty(facade, 'cancel', {
            configurable: true,
            writable: true,
            value: () => {
                if (binding.cancelled) {
                    throw invalidState('The IWER-controlled hit test source has already been cancelled.');
                }
                this.disposeHitTestBinding(binding);
            },
        });
        return facade;
    }
    /**
     * Subscribes a fresh native hit test source at the given anchor-relative
     * pose, swapping it in only once the browser resolves it. The previous
     * subscription keeps serving results throughout, and survives a failure, so
     * the facade never goes blank once it has resolved a subscription.
     */
    requestBackingSource(binding, matrix) {
        const token = ++binding.pendingToken;
        binding.pendingMatrix = clone(matrix);
        const adapter = binding.adapter;
        let request;
        try {
            const space = this.createDetachedOffsetSpace(adapter, matrix);
            request = Promise.resolve(binding.nativeMethod.call(adapter.session, {
                ...binding.requestedOptions,
                space,
            }));
        }
        catch (error) {
            request = Promise.reject(error);
        }
        return request.then((source) => {
            if (token !== binding.pendingToken ||
                binding.cancelled ||
                adapter.ended ||
                !this.installedState) {
                this.cancelNativeHitTestSource(source);
                return;
            }
            const replaced = binding.current;
            binding.current = source;
            binding.currentMatrix = binding.pendingMatrix;
            binding.pendingMatrix = null;
            binding.failures = 0;
            binding.backoffFrames = 0;
            this.cancelNativeHitTestSource(replaced);
        }, (error) => {
            if (token === binding.pendingToken && !binding.cancelled) {
                binding.pendingMatrix = null;
                binding.failures += 1;
                // Keep the last subscription that did work. A failed replacement is
                // usually transient (tracking loss, a frame without an AR plane), and
                // discarding a working subscription would turn it into data loss.
                binding.backoffFrames = Math.min(2 ** Math.min(binding.failures, 5), MAX_HIT_TEST_BACKOFF_FRAMES);
            }
            throw error;
        });
    }
    /**
     * Creates a world-locked native offset space at the given anchor-relative
     * pose. The space is deliberately untagged so native APIs treat it as an
     * ordinary browser space.
     */
    createDetachedOffsetSpace(adapter, matrix) {
        const transform = this.rigidTransformFromMatrix(matrix);
        // Untag the anchor space for this one call so the derived space is a plain
        // browser space: it inherits no controlled metadata and needs no patching.
        const anchorInfo = this.spaces.get(adapter.anchorSpace);
        this.spaces.delete(adapter.anchorSpace);
        try {
            return adapter.anchorSpace.getOffsetReferenceSpace(transform);
        }
        finally {
            if (anchorInfo) {
                this.spaces.set(adapter.anchorSpace, anchorInfo);
            }
        }
    }
    updateHitTestSources(adapter) {
        if (adapter.hitTests.size === 0) {
            return;
        }
        for (const binding of Array.from(adapter.hitTests)) {
            if (binding.cancelled) {
                continue;
            }
            // Exactly one replacement is ever in flight, so a space that moves every
            // frame costs one subscription per round trip rather than one per frame.
            if (binding.pendingMatrix) {
                continue;
            }
            if (binding.backoffFrames > 0) {
                binding.backoffFrames -= 1;
                continue;
            }
            const info = this.spaces.get(binding.space);
            if (!info) {
                continue;
            }
            const matrix = this.controlledSpaceToAnchor(info, scratchHitTestMatrix);
            if (!matrix) {
                continue;
            }
            if (binding.currentMatrix &&
                poseWithinTolerance(binding.currentMatrix, matrix)) {
                continue;
            }
            void this.requestBackingSource(binding, matrix).catch((error) => {
                this.note(`A native hit test subscription could not follow its IWER-controlled space: ${this.errorText(error)}`, 'hit-test-resubscribe-failed');
            });
        }
    }
    handleGetHitTestResults(frame, nativeMethod, hitTestSource) {
        if (!this.installedState) {
            return nativeMethod.call(frame, hitTestSource);
        }
        const binding = this.hitTestBindings.get(hitTestSource);
        if (!binding) {
            return nativeMethod.call(frame, hitTestSource);
        }
        if (binding.cancelled) {
            throw invalidState('The IWER-controlled hit test source has been cancelled.');
        }
        const adapter = this.adapterForFrame(frame);
        if (!adapter || adapter !== binding.adapter) {
            throw invalidState('The IWER-controlled hit test source belongs to a different native session.');
        }
        if (adapter.framesInstrumented && adapter.activeFrame !== frame) {
            throw invalidState("Failed to execute 'getHitTestResults' on 'XRFrame': the frame is not active.");
        }
        if (!binding.current) {
            return [];
        }
        // Serve the last subscription the browser actually resolved, including
        // while a replacement is in flight. Its pose trails the controlled space by
        // at most the resubscribe tolerance plus one round trip, which is far more
        // useful than reporting nothing.
        return nativeMethod.call(frame, binding.current);
    }
    cancelNativeHitTestSource(source) {
        if (!source) {
            return;
        }
        try {
            source.cancel();
        }
        catch (_a) {
            // A session that already ended cancels its own subscriptions.
        }
    }
    disposeHitTestBinding(binding) {
        binding.cancelled = true;
        binding.pendingToken += 1;
        binding.pendingMatrix = null;
        this.cancelNativeHitTestSource(binding.current);
        binding.current = null;
        binding.currentMatrix = null;
        binding.adapter.hitTests.delete(binding);
    }
    // ===========================================================================
    // Lifecycle
    // ===========================================================================
    adapterForFrame(frame) {
        var _a;
        const tagged = this.frameSessions.get(frame);
        if (tagged && !tagged.ended) {
            return tagged;
        }
        try {
            return (_a = this.sessionsByObject.get(frame.session)) !== null && _a !== void 0 ? _a : null;
        }
        catch (_b) {
            return null;
        }
    }
    /**
     * Throws if the frame is no longer the one its session owns. Browser spaces
     * already get this for free because the native call raises, but a query that
     * only touches IWER-controlled spaces never reaches the browser, and
     * answering it would let a stashed frame silently report live poses.
     */
    assertFrameActive(adapter, frame, method) {
        if (!adapter.framesInstrumented) {
            return;
        }
        if (adapter.activeFrame !== frame) {
            throw invalidState(`Failed to execute '${method}' on 'XRFrame': the frame is not active.`);
        }
    }
    constructorPrototype(name) {
        var _a;
        const constructor = globalRecord(this.globalObject)[name];
        return (_a = constructor === null || constructor === void 0 ? void 0 : constructor.prototype) !== null && _a !== void 0 ? _a : null;
    }
    detachSession(session) {
        const adapter = this.sessionsByObject.get(session);
        if (adapter) {
            this.detachAdapter(adapter);
        }
    }
    detachAdapter(adapter, announceNativeInputTransition = false) {
        var _a;
        if (adapter.ended) {
            return;
        }
        const removedSources = this.options.mode === 'gaze-only'
            ? adapter.sources.filter((source) => adapter.bindingByFacade.has(source))
            : [...adapter.sources];
        const wasFramePreparationUnhealthy = this.unhealthyFrameAdapters.delete(adapter);
        adapter.ended = true;
        for (const cleanup of adapter.cleanupListeners.splice(0)) {
            try {
                cleanup();
            }
            catch (_b) {
                // A hostile EventTarget must not prevent the remaining patches and
                // runtime state from being restored.
            }
        }
        // Release whatever was still held at teardown so a press that was live
        // when the override went away cannot leak into the next runtime as a
        // phantom edge. Shared buttons are only zeroed by the current driver.
        const clearsSharedInputState = adapter === this.sharedStateDriver();
        for (const binding of adapter.deviceBindings) {
            for (const button of binding.eventButtons) {
                if (clearsSharedInputState) {
                    this.releaseButton(button);
                }
                binding.previousButtonValues.set(button, button.value);
            }
            binding.activeButtons.clear();
        }
        for (const binding of Array.from(adapter.hitTests)) {
            this.disposeHitTestBinding(binding);
        }
        adapter.instancePatches.revert();
        adapter.patches.revert();
        adapter.baseSpaceCache.clear();
        adapter.activeFrame = null;
        adapter.lastPreparedFrame = null;
        this.sessionsByObject.delete(adapter.session);
        if (announceNativeInputTransition) {
            // uninstall() keeps the browser session alive. Once its native getter has
            // been restored, announce both sides of the membership transition so
            // event-driven consumers release synthetic facades and discover the
            // browser's real input sources. Session-end cleanup intentionally skips
            // this event because the session itself is no longer usable.
            let addedSources = [];
            if (this.options.mode === 'full') {
                try {
                    addedSources = Array.from(adapter.session.inputSources);
                }
                catch (_c) {
                    // A hostile native getter must not make teardown fail.
                }
            }
            if (addedSources.length > 0 || removedSources.length > 0) {
                try {
                    this.dispatchInputSourcesChange(adapter, addedSources, removedSources);
                }
                catch (_d) {
                    // Event construction or dispatch must not make teardown fail.
                }
            }
        }
        adapter.sources = Object.freeze([]);
        adapter.deviceBindings.splice(0);
        adapter.playbackBindings.clear();
        adapter.bindingByFacade.clear();
        adapter.spaceTokens.clear();
        adapter.pendingEvents.length = 0;
        adapter.retainedSources.clear();
        this.liveSessions.delete(adapter);
        if (wasFramePreparationUnhealthy &&
            this.unhealthyFrameAdapters.size === 0 &&
            this.installedState) {
            this.capabilityState.supported = true;
        }
        if (this.primarySession === adapter) {
            this.primarySession = (_a = this.liveSessions.values().next().value) !== null && _a !== void 0 ? _a : null;
            this.lastPrimaryTime = undefined;
        }
        if (this.liveSessions.size === 0) {
            this.unwirePlayer();
            this.playbackFrame = null;
            this.device.remote.forceRelease();
        }
    }
    resetPatchTracking() {
        this.sessionsByObject = new WeakMap();
        this.frameSessions = new WeakMap();
        this.spaces = new WeakMap();
        this.hitTestBindings = new WeakMap();
        this.syntheticEvents = new WeakSet();
        this.patchedFrameOwners = new WeakSet();
        this.patchedViewerFrameOwners = new WeakSet();
        this.patchedFillPosesOwners = new WeakSet();
        this.patchedJointPoseOwners = new WeakSet();
        this.patchedJointRadiiOwners = new WeakSet();
        this.patchedReferenceSpaceOwners = new WeakSet();
        this.patchedEnabledFeaturesOwners = new WeakSet();
        this.patchedInputSourceOwners = new WeakSet();
        this.patchedRafOwners = new WeakSet();
        this.patchedRequestReferenceSpaceOwners = new WeakSet();
        this.instancePatchedReferenceSpaces = new WeakSet();
        this.patchedHitTestOwners = new WeakSet();
        this.patchedHitTestResultOwners = new WeakSet();
        this.patchedCreateAnchorOwners = new WeakSet();
        this.rawGetPoseByOwner = new WeakMap();
        this.rawGetPoseByFrame = new WeakMap();
        this.rawRafByOwner = new WeakMap();
        this.rawRequestReferenceSpaceByOwner = new WeakMap();
        this.rawInputSourcesGetterByOwner = new WeakMap();
        this.rawTransformGetters = new WeakMap();
        this.transformReaders = new WeakMap();
        this.transformOverrides = new WeakMap();
        this.patchedTransformOwners = new WeakSet();
        this.instancePatchedFrameEpochs = new WeakMap();
        this.instancePatchedTransformEpochs = new WeakMap();
        this.unhealthyFrameAdapters.clear();
        this.lastPrimaryTime = undefined;
    }
    unsupportedForSession(adapter, message) {
        if (this.options.onUnsupported === 'throw') {
            this.detachAdapter(adapter);
            throw new Error(message);
        }
        this.note(message);
    }
    unsupported(message) {
        this.capabilityState.supported = false;
        this.note(message);
        if (this.options.onUnsupported === 'throw') {
            throw new Error(message);
        }
    }
    note(message, key = message) {
        if (this.warned.has(key)) {
            return;
        }
        this.warned.add(key);
        this.capabilityState.notes.push(message);
        console.warn(`[IWER native override] ${message}`);
    }
    errorText(error) {
        return error instanceof Error
            ? `${error.name}: ${error.message}`
            : String(error);
    }
}
/** Installs a native override and returns its lifecycle handle. */
function installNativeOverride(device, options) {
    const override = new XRNativeOverride(device, options);
    override.install();
    return override;
}

/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
const compress = (arr) => {
    const out = [];
    Array.from(arr).forEach((num) => {
        out.push(Math.round(num * 1000) / 1000);
    });
    return out;
};
// Module-level scratch buffers reused for per-joint translation/rotation
// extraction. Their contents are compressed (copied out) immediately after
// each use, so they are never retained across joints or frames.
const _scratchJointVec3 = create$4();
const _scratchJointQuat = create$2();
class ActionRecorder {
    constructor(session, refSpace, options = {}) {
        var _a;
        this[P_ACTION_RECORDER] = {
            session,
            refSpace,
            inputMap: new Map(),
            schemaMap: new Map(),
            compressedFrames: [],
            jointRadii: new Float32Array(25),
            jointTransforms: new Float32Array(25 * 16),
            maxFrames: options.maxFrames != null && options.maxFrames > 0
                ? options.maxFrames
                : Infinity,
            maxDurationMs: options.maxDurationMs != null && options.maxDurationMs > 0
                ? options.maxDurationMs
                : Infinity,
            capPolicy: (_a = options.capPolicy) !== null && _a !== void 0 ? _a : 'stop',
            firstTimeStamp: null,
            lastTimeStamp: null,
        };
    }
    /** Number of frames currently recorded. */
    get frameCount() {
        return this[P_ACTION_RECORDER].compressedFrames.length;
    }
    /**
     * Duration of the recording in milliseconds, measured from the first to the
     * most recently recorded frame. Returns 0 when fewer than two frames have
     * been recorded.
     */
    get durationMs() {
        const state = this[P_ACTION_RECORDER];
        if (state.firstTimeStamp == null || state.lastTimeStamp == null) {
            return 0;
        }
        return state.lastTimeStamp - state.firstTimeStamp;
    }
    recordFrame(frame) {
        var _a;
        const state = this[P_ACTION_RECORDER];
        const timeStamp = performance.now();
        // Enforce the duration cap up front: under the 'stop' policy, once the cap
        // is reached we keep what we have and skip recording new frames entirely.
        if (state.capPolicy === 'stop' &&
            state.firstTimeStamp != null &&
            timeStamp - state.firstTimeStamp >= state.maxDurationMs) {
            return;
        }
        // Likewise, under 'stop' refuse new frames once the frame cap is hit.
        if (state.capPolicy === 'stop' &&
            state.compressedFrames.length >= state.maxFrames) {
            return;
        }
        const viewerMatrix = (_a = frame.getViewerPose(this[P_ACTION_RECORDER].refSpace)) === null || _a === void 0 ? void 0 : _a.transform.matrix;
        if (!viewerMatrix)
            return;
        const position = getTranslation(create$4(), viewerMatrix);
        const quaternion = getRotation(create$2(), viewerMatrix);
        const actionFrame = {
            timeStamp,
            position,
            quaternion,
            inputFrames: [],
        };
        this[P_ACTION_RECORDER].session.inputSources.forEach((inputSource) => {
            var _a, _b;
            if (!this[P_ACTION_RECORDER].inputMap.has(inputSource)) {
                const schema = {
                    handedness: inputSource.handedness,
                    targetRayMode: inputSource.targetRayMode,
                    profiles: inputSource.profiles,
                    hasGrip: inputSource.gripSpace != null,
                    hasHand: inputSource.hand != null,
                    hasGamepad: inputSource.gamepad != null,
                };
                if (schema.hasHand) {
                    schema.jointSequence = Array.from(inputSource.hand.values()).map((jointSpace) => jointSpace.jointName);
                }
                if (schema.hasGamepad) {
                    schema.mapping = inputSource.gamepad.mapping;
                    schema.numButtons = inputSource.gamepad.buttons.length;
                    schema.numAxes = inputSource.gamepad.axes.length;
                }
                const index = this[P_ACTION_RECORDER].inputMap.size;
                this[P_ACTION_RECORDER].inputMap.set(inputSource, index);
                this[P_ACTION_RECORDER].schemaMap.set(index, schema);
            }
            const index = this[P_ACTION_RECORDER].inputMap.get(inputSource);
            const schema = this[P_ACTION_RECORDER].schemaMap.get(index);
            const targetRayMatrix = (_a = frame.getPose(inputSource.targetRaySpace, this[P_ACTION_RECORDER].refSpace)) === null || _a === void 0 ? void 0 : _a.transform.matrix;
            if (targetRayMatrix) {
                const targetRayPosition = getTranslation(create$4(), targetRayMatrix);
                const targetRayQuaternion = getRotation(create$2(), targetRayMatrix);
                const inputFrame = {
                    index,
                    targetRayTransform: {
                        position: targetRayPosition,
                        quaternion: targetRayQuaternion,
                    },
                };
                if (schema.hasGrip) {
                    const gripMatrix = (_b = frame.getPose(inputSource.gripSpace, this[P_ACTION_RECORDER].refSpace)) === null || _b === void 0 ? void 0 : _b.transform.matrix;
                    if (gripMatrix) {
                        const position = getTranslation(create$4(), gripMatrix);
                        const quaternion = getRotation(create$2(), gripMatrix);
                        inputFrame.gripTransform = {
                            position,
                            quaternion,
                        };
                    }
                }
                if (schema.hasHand) {
                    const jointSpaces = Array.from(inputSource.hand.values());
                    let allValid = true;
                    // @ts-ignore
                    allValid && (allValid = frame.fillPoses(jointSpaces, inputSource.targetRaySpace, this[P_ACTION_RECORDER].jointTransforms));
                    // @ts-ignore
                    allValid && (allValid = frame.fillJointRadii(jointSpaces, this[P_ACTION_RECORDER].jointRadii));
                    if (allValid) {
                        const hand = {};
                        for (let offset = 0; offset < 25; offset++) {
                            const jointMatrix = this[P_ACTION_RECORDER].jointTransforms.slice(offset * 16, (offset + 1) * 16);
                            const radius = this[P_ACTION_RECORDER].jointRadii[offset];
                            // Reuse module-level scratch buffers, then compress (copy out)
                            // immediately so the scratch contents are never retained.
                            getTranslation(_scratchJointVec3, jointMatrix);
                            getRotation(_scratchJointQuat, jointMatrix);
                            const position = compress(_scratchJointVec3);
                            const quaternion = compress(_scratchJointQuat);
                            const jointName = jointSpaces[offset].jointName;
                            hand[jointName] = { position, quaternion, radius };
                        }
                        inputFrame.hand = hand;
                    }
                }
                if (schema.hasGamepad) {
                    const gamepad = {
                        buttons: inputSource.gamepad.buttons.map((button) => button
                            ? [button.pressed ? 1 : 0, button.touched ? 1 : 0, button.value]
                            : null),
                        axes: Array.from(inputSource.gamepad.axes),
                    };
                    inputFrame.gamepad = gamepad;
                }
                actionFrame.inputFrames.push(inputFrame);
            }
        });
        const frames = state.compressedFrames;
        frames.push(this.compressActionFrame(actionFrame));
        if (state.firstTimeStamp == null) {
            state.firstTimeStamp = timeStamp;
        }
        state.lastTimeStamp = timeStamp;
        // Under the 'drop' policy, maintain a sliding window by discarding the
        // oldest frames once a cap is exceeded.
        if (state.capPolicy === 'drop') {
            while (frames.length > state.maxFrames) {
                frames.shift();
            }
            while (frames.length > 1 &&
                timeStamp - state.firstTimeStamp >= state.maxDurationMs) {
                frames.shift();
                // firstTimeStamp tracks the oldest retained frame's timestamp; since
                // individual frame timestamps are compressed in storage, advance it by
                // re-reading the new head frame's timeStamp (stored at index 0).
                state.firstTimeStamp = frames[0][0];
            }
        }
    }
    compressActionFrame(af) {
        const out = [
            Math.round(af.timeStamp * 10) / 10,
            ...compress(af.position),
            ...compress(af.quaternion),
        ];
        af.inputFrames.forEach((inputFrame) => {
            const index = inputFrame.index;
            const schema = this[P_ACTION_RECORDER].schemaMap.get(index);
            const inputOut = [
                index,
                ...compress(inputFrame.targetRayTransform.position),
                ...compress(inputFrame.targetRayTransform.quaternion),
            ];
            if (schema.hasGrip) {
                inputOut.push([
                    ...compress(inputFrame.gripTransform.position),
                    ...compress(inputFrame.gripTransform.quaternion),
                ]);
            }
            if (schema.hasHand) {
                const handArr = [];
                Object.values(inputFrame.hand).forEach(({ position, quaternion, radius }) => {
                    // position/quaternion were already compressed at record time.
                    handArr.push(...position, ...quaternion, Math.round(radius * 1000) / 1000);
                });
                inputOut.push(handArr);
            }
            if (schema.hasGamepad) {
                inputOut.push([
                    ...inputFrame.gamepad.buttons,
                    ...inputFrame.gamepad.axes,
                ]);
            }
            out.push(inputOut);
        });
        return out;
    }
    /**
     * Build the serialized recording object (the same shape ActionPlayer's
     * constructor consumes): the schema entries paired with the compressed frame
     * rows. Returned by reference, so callers that mutate it affect the recorder's
     * live buffers; clone if you need a detached snapshot.
     */
    getRecording() {
        return {
            schema: Array.from(this[P_ACTION_RECORDER].schemaMap.entries()),
            frames: this[P_ACTION_RECORDER].compressedFrames,
        };
    }
    /** Serialize the current recording to a JSON string. */
    toJSON() {
        return JSON.stringify(this.getRecording());
    }
    log() {
        console.log(this.toJSON());
    }
}

export { ActionPlayer, ActionRecorder, GAZE_TRACKING_FEATURES, GamepadMappingType, GlobalSpace, NativeMesh, NativePlane, P_ACTION_PLAYER, P_ACTION_RECORDER, P_ANCHOR, P_CONTROLLER, P_DEPTH_INFO, P_DEVICE, P_FRAME, P_GAMEPAD, P_HAND_INPUT, P_HIT_TEST, P_INPUT_SOURCE, P_JOINT_POSE, P_JOINT_SPACE, P_MESH, P_PLANE, P_POSE, P_RAY, P_REF_SPACE, P_RENDER_STATE, P_RIGID_TRANSFORM, P_SESSION, P_SPACE, P_SYSTEM, P_TRACKED_INPUT, P_VIEW, P_VIEWER_POSE, P_VIEWPORT, P_WEBGL_LAYER, RemoteControlInterface, XRAnchor, XRAnchorSet, XRCPUDepthInformation, XRDevice, XRFrame, XRGazeInput, XRHand, XRInputSource, XRInputSourceArray, XRInputSourceEvent, XRInputSourcesChangeEvent, XRJointPose, XRJointSpace, XRLayer, XRMesh, XRMeshSet, XRNativeOverride, XRPlane, XRPlaneSet, XRPose, XRRay, XRReferenceSpace, XRReferenceSpaceEvent, XRReferenceSpaceType, XRRenderState, XRRigidTransform, XRSemanticLabels, XRSession, XRSessionEvent, XRSpace, XRSystem, XRView, XRViewerPose, XRViewport, XRWebGLBinding, XRWebGLDepthInformation, XRWebGLLayer, calculateVisibilityMaskBounds, directionTo, eulerToQuat, generic, getNativeOverride, getNativeOverrideSupport, installNativeOverride, isGazeTrackingFeature, lookRotation, metaQuest2, metaQuest3, metaQuestPro, metaQuestTouchPlus, metaQuestTouchPro, metaVRGlasses, metaVRGlassesVisibilityMask, oculusQuest1, oculusTouchV2, oculusTouchV3, quatToEuler, quatToObj, supportsGazeTracking, vec3ToObj, waitForCondition };
