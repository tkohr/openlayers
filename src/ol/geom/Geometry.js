/**
 * @module ol/geom/Geometry
 */
import {abstract} from '../util.js';
import BaseObject from '../Object.js';
import {createEmpty, getHeight, returnOrUpdate} from '../extent.js';
import {transform2D} from './flat/transform.js';
import {get as getProjection, getTransform, getTransformFromProjections} from '../proj.js';
import Units from '../proj/Units.js';
import {create as createTransform, compose as composeTransform} from '../transform.js';
import {memoizeOne} from '../functions.js';

/**
 * @type {import("../transform.js").Transform}
 */
const tmpTransform = createTransform();


/**
 * @classdesc
 * Abstract base class; normally only used for creating subclasses and not
 * instantiated in apps.
 * Base class for vector geometries.
 *
 * To get notified of changes to the geometry, register a listener for the
 * generic `change` event on your geometry instance.
 *
 * @abstract
 * @api
 */
class Geometry extends BaseObject {
  constructor() {

    super();

    /**
     * @private
     * @type {import("../extent.js").Extent}
     */
    this.extent_ = createEmpty();

    /**
     * @private
     * @type {number}
     */
    this.extentRevision_ = -1;

    /**
     * @protected
     * @type {number}
     */
    this.simplifiedGeometryMaxMinSquaredTolerance = 0;

    /**
     * @protected
     * @type {number}
     */
    this.simplifiedGeometryRevision = 0;

    /**
     * Get a transformed and simplified version of the geometry.
     * @abstract
     * @param {number} revision The geometry revision.
     * @param {number} squaredTolerance Squared tolerance.
     * @param {import("../proj/Projection.js").default} [sourceProjection] The source projection.
     * @param {import("../proj/Projection.js").default} [destProjection] The destination projection.
     * @return {Geometry} Simplified geometry.
     */
    this.simplifyTransformedInternal = memoizeOne(function(revision, squaredTolerance, sourceProjection, destProjection) {
      if (!sourceProjection || !destProjection) {
        return this.getSimplifiedGeometry(squaredTolerance);
      }
      const transform = getTransformFromProjections(sourceProjection, destProjection);
      const clone = this.clone();
      clone.applyTransform(transform);
      return clone.getSimplifiedGeometry(squaredTolerance);
    });

  }

  /**
   * Get a transformed and simplified version of the geometry.
   * @abstract
   * @param {number} squaredTolerance Squared tolerance.
   * @param {import("../proj/Projection.js").default} sourceProjection The source projection.
   * @param {import("../proj/Projection.js").default} destProjection The destination projection.
   * @return {Geometry} Simplified geometry.
   */
  simplifyTransformed(squaredTolerance, sourceProjection, destProjection) {
    return this.simplifyTransformedInternal(this.getRevision(), squaredTolerance, sourceProjection, destProjection);
  }

  /**
   * Make a complete copy of the geometry.
   * @abstract
   * @return {!Geometry} Clone.
   */
  clone() {
    return abstract();
  }

  /**
   * @abstract
   * @param {number} x X.
   * @param {number} y Y.
   * @param {import("../coordinate.js").Coordinate} closestPoint Closest point.
   * @param {number} minSquaredDistance Minimum squared distance.
   * @return {number} Minimum squared distance.
   */
  closestPointXY(x, y, closestPoint, minSquaredDistance) {
    return abstract();
  }

  /**
   * @param {number} x X.
   * @param {number} y Y.
   * @return {boolean} Contains (x, y).
   */
  containsXY(x, y) {
    const coord = this.getClosestPoint([x, y]);
    return coord[0] === x && coord[1] === y;
  }

  /**
   * Return the closest point of the geometry to the passed point as
   * {@link module:ol/coordinate~Coordinate coordinate}.
   * @param {import("../coordinate.js").Coordinate} point Point.
   * @param {import("../coordinate.js").Coordinate=} opt_closestPoint Closest point.
   * @return {import("../coordinate.js").Coordinate} Closest point.
   * @api
   */
  getClosestPoint(point, opt_closestPoint) {
    const closestPoint = opt_closestPoint ? opt_closestPoint : [NaN, NaN];
    this.closestPointXY(point[0], point[1], closestPoint, Infinity);
    return closestPoint;
  }

  /**
   * Returns true if this geometry includes the specified coordinate. If the
   * coordinate is on the boundary of the geometry, returns false.
   * @param {import("../coordinate.js").Coordinate} coordinate Coordinate.
   * @return {boolean} Contains coordinate.
   * @api
   */
  intersectsCoordinate(coordinate) {
    return this.containsXY(coordinate[0], coordinate[1]);
  }

  /**
   * @abstract
   * @param {import("../extent.js").Extent} extent Extent.
   * @protected
   * @return {import("../extent.js").Extent} extent Extent.
   */
  computeExtent(extent) {
    return abstract();
  }

  /**
   * Get the extent of the geometry.
   * @param {import("../extent.js").Extent=} opt_extent Extent.
   * @return {import("../extent.js").Extent} extent Extent.
   * @api
   */
  getExtent(opt_extent) {
    if (this.extentRevision_ != this.getRevision()) {
      this.extent_ = this.computeExtent(this.extent_);
      this.extentRevision_ = this.getRevision();
    }
    return returnOrUpdate(this.extent_, opt_extent);
  }

  /**
   * Rotate the geometry around a given coordinate. This modifies the geometry
   * coordinates in place.
   * @abstract
   * @param {number} angle Rotation angle in radians.
   * @param {import("../coordinate.js").Coordinate} anchor The rotation center.
   * @api
   */
  rotate(angle, anchor) {
    abstract();
  }

  /**
   * Scale the geometry (with an optional origin).  This modifies the geometry
   * coordinates in place.
   * @abstract
   * @param {number} sx The scaling factor in the x-direction.
   * @param {number=} opt_sy The scaling factor in the y-direction (defaults to
   *     sx).
   * @param {import("../coordinate.js").Coordinate=} opt_anchor The scale origin (defaults to the center
   *     of the geometry extent).
   * @api
   */
  scale(sx, opt_sy, opt_anchor) {
    abstract();
  }

  /**
   * Create a simplified version of this geometry.  For linestrings, this uses
   * the [Douglas Peucker](https://en.wikipedia.org/wiki/Ramer-Douglas-Peucker_algorithm)
   * algorithm.  For polygons, a quantization-based
   * simplification is used to preserve topology.
   * @param {number} tolerance The tolerance distance for simplification.
   * @return {Geometry} A new, simplified version of the original geometry.
   * @api
   */
  simplify(tolerance) {
    return this.getSimplifiedGeometry(tolerance * tolerance);
  }

  /**
   * Create a simplified version of this geometry using the Douglas Peucker
   * algorithm.
   * See https://en.wikipedia.org/wiki/Ramer-Douglas-Peucker_algorithm.
   * @abstract
   * @param {number} squaredTolerance Squared tolerance.
   * @return {Geometry} Simplified geometry.
   */
  getSimplifiedGeometry(squaredTolerance) {
    return abstract();
  }

  /**
   * Get the type of this geometry.
   * @abstract
   * @return {import("./GeometryType.js").default} Geometry type.
   */
  getType() {
    return abstract();
  }

  /**
   * Apply a transform function to each coordinate of the geometry.
   * The geometry is modified in place.
   * If you do not want the geometry modified in place, first `clone()` it and
   * then use this function on the clone.
   * @abstract
   * @param {import("../proj.js").TransformFunction} transformFn Transform.
   */
  applyTransform(transformFn) {
    abstract();
  }

  /**
   * Test if the geometry and the passed extent intersect.
   * @abstract
   * @param {import("../extent.js").Extent} extent Extent.
   * @return {boolean} `true` if the geometry and the extent intersect.
   */
  intersectsExtent(extent) {
    return abstract();
  }

  /**
   * Translate the geometry.  This modifies the geometry coordinates in place.  If
   * instead you want a new geometry, first `clone()` this geometry.
   * @abstract
   * @param {number} deltaX Delta X.
   * @param {number} deltaY Delta Y.
   * @api
   */
  translate(deltaX, deltaY) {
    abstract();
  }

  /**
   * Transform each coordinate of the geometry from one coordinate reference
   * system to another. The geometry is modified in place.
   * For example, a line will be transformed to a line and a circle to a circle.
   * If you do not want the geometry modified in place, first `clone()` it and
   * then use this function on the clone.
   *
   * @param {import("../proj.js").ProjectionLike} source The current projection.  Can be a
   *     string identifier or a {@link module:ol/proj/Projection~Projection} object.
   * @param {import("../proj.js").ProjectionLike} destination The desired projection.  Can be a
   *     string identifier or a {@link module:ol/proj/Projection~Projection} object.
   * @return {Geometry} This geometry.  Note that original geometry is
   *     modified in place.
   * @api
   */
  transform(source, destination) {
    /** @type {import("../proj/Projection.js").default} */
    const sourceProj = getProjection(source);
    const transformFn = sourceProj.getUnits() == Units.TILE_PIXELS ?
      function(inCoordinates, outCoordinates, stride) {
        const pixelExtent = sourceProj.getExtent();
        const projectedExtent = sourceProj.getWorldExtent();
        const scale = getHeight(projectedExtent) / getHeight(pixelExtent);
        composeTransform(tmpTransform,
          projectedExtent[0], projectedExtent[3],
          scale, -scale, 0,
          0, 0);
        transform2D(inCoordinates, 0, inCoordinates.length, stride,
          tmpTransform, outCoordinates);
        return getTransform(sourceProj, destination)(inCoordinates, outCoordinates, stride);
      } :
      getTransform(sourceProj, destination);
    this.applyTransform(transformFn);
    return this;
  }

}


export default Geometry;
