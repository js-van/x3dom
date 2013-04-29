/*
 * X3DOM JavaScript Library
 * http://www.x3dom.org
 *
 * (C)2009 Fraunhofer IGD, Darmstadt, Germany
 * Dual licensed under the MIT and GPL
 *
 * Based on code originally provided by
 * Philip Taylor: http://philip.html5.org
 */

 
/**
 *
 */
x3dom.DrawableCollection = function (drawableCollectionConfig)
{
  this.collection = [];

  this.viewMatrix = drawableCollectionConfig.viewMatrix;
  this.projMatrix = drawableCollectionConfig.projMatrix;
  this.sceneMatrix = drawableCollectionConfig.sceneMatrix;

  this.viewarea = drawableCollectionConfig.viewArea;

  var viewpoint = this.viewarea._scene.getViewpoint();

  this.near = viewpoint.getNear();
  this.imgPlaneHeightAtDistOne = viewpoint.getImgPlaneHeightAtDistOne() / this.viewarea._height;

  this.context = drawableCollectionConfig.context;
  this.gl = drawableCollectionConfig.gl;

  this.viewFrustum = this.viewarea.getViewfrustum(this.sceneMatrix);

  this.frustumCulling = drawableCollectionConfig.frustumCulling && (this.viewFrustum != null);
  this.smallFeatureThreshold = drawableCollectionConfig.smallFeatureThreshold;

  this.sortOpaque = false; // this.smallFeatureThreshold > 1;
  this.sortTrans = drawableCollectionConfig.sortTrans;

  this.sortBySortKey = false;
  this.sortByPriority = false;
  
  this.numberOfNodes = 0;
  
  this.length = 0;
};

/**
 *  graphState = {
 *     boundedNode:  backref to bounded node object
 *     localMatrix:  mostly identity
 *     globalMatrix: current transform
 *     volume:       local bbox
 *     worldVolume:  global bbox
 *     center:       center in eye coords
 *     coverage:     currently approx. number of pixels on screen
 *  };
 */
x3dom.DrawableCollection.prototype.cull = function(transform, graphState)
{
    var node = graphState.boundedNode;  // ref to SG node
    var volume = node.getVolume();      // create on request

    if (this.frustumCulling) {
        graphState.worldVolume.transformFrom(transform, volume);

        if (!this.viewFrustum.intersect(graphState.worldVolume)) {
            return true;      // if culled return true
        }
    }

    graphState.globalMatrix = transform; // attention, this matrix maybe shared
    graphState.coverage = -1;            // if -1 then ignore value later on

    if (this.smallFeatureThreshold > 1) {
        // a few ops less than with this.viewMatrix.mult(transform)
        graphState.center = transform.multMatrixPnt(volume.getCenter());
        graphState.center = this.viewMatrix.multMatrixPnt(graphState.center);

        var dia = volume.getDiameter();

        var dist = Math.max(-graphState.center.z - dia / 2.0, this.near);
        var projPixelLength = dist * this.imgPlaneHeightAtDistOne;

        graphState.coverage = dia / projPixelLength;    // shall we norm this to be in [0,1]?

        if (graphState.coverage < this.smallFeatureThreshold) {
            return true;
        }
    }

    // not culled, incr node cnt
    this.numberOfNodes++;

    return false;
};

/**
 * A drawable is basically a unique pair of a shape node and a global transformation.
 */
x3dom.DrawableCollection.prototype.addDrawable = function ( shape, transform, graphState )
{
  //Create a new drawable object
  var drawable = {};
  
  //Set the shape
  drawable.shape = shape;
  
  //Set the transform
  drawable.transform = transform;

  drawable.localTransform = graphState.localMatrix;

  //Set the local bounding box (reference, can be shared amongst shapes)
  drawable.localVolume = graphState.volume;
  
  //Set the global bbox (needs to be cloned since shape can be shared)
  drawable.worldVolume = x3dom.fields.BoxVolume.copy(graphState.worldVolume);

  //Calculate the magical object priority (though currently not very magic)
  // TODO; reuse graphState.coverage in updatePopState() during rendering
  drawable.priority = Math.min(0, graphState.coverage);

  var appearance = shape._cf.appearance.node;

  drawable.sortType = appearance ? appearance._vf.sortType.toLowerCase() : "opaque";
  drawable.sortKey  = appearance ? appearance._vf.sortKey  : 0;

  if (drawable.sortType == 'transparent') {
      if (this.smallFeatureThreshold > 1) {
        drawable.zPos = graphState.center.z;
      }
      else {
        //Calculate the z-Pos for transparent object sorting
        //if the center of the box is not available
        var center = transform.multMatrixPnt(shape.getCenter());
        center = this.viewMatrix.multMatrixPnt(center);
        drawable.zPos = center.z;
      }
  }
  
  //Generate the shader properties
  //drawable.properties = x3dom.Utils.generateProperties(this.viewarea, shape);

  //Look for sorting by sortKey
  if (!this.sortBySortKey && drawable.sortKey != 0) {
    this.sortBySortKey = true;
  }

  //Generate separate array for sortType if not exists
  if (this.collection[drawable.sortType] === undefined) {
    this.collection[drawable.sortType] = [];
  }
  
  //Push drawable to the collection
  this.collection[drawable.sortType].push( drawable );
  
  //Increment collection length
  this.length++;

  //Finally setup shape directly here to avoid another loop of O(n)
  if (this.context && this.gl) {
    this.context.setupShape(this.gl, drawable, this.viewarea);
  }
  else {
    //TODO: also setup Flash?
  }
};

/**
 *
 */
x3dom.DrawableCollection.prototype.concat = function () {
  var opaque = (this.collection['opaque'] !== undefined) ? this.collection['opaque'] : [];
  var transparent = (this.collection['transparent'] !== undefined) ? this.collection['transparent'] : [];
  
  //Merge opaque and transparent drawables to a single array
  this.collection = opaque.concat(transparent);
};

/**
 *
 */
x3dom.DrawableCollection.prototype.get = function ( idx ) {
  return this.collection[idx];
};

/**
 *
 */
x3dom.DrawableCollection.prototype.sort = function ()
{
  var opaque = [];
  var transparent = [];

  //Sort opaque drawables
  if (this.collection['opaque'] !== undefined) {
    // uhh, never call this for bigger scenes greater 1000 objects, very very slow
    // TODO; revert to old binning approach (before 836491546f302fa9874e5ab372f747906732bb7f)
    if ( this.sortOpaque) {
      this.collection['opaque'].sort(function(a,b) {
        if(a.sortKey == b.sortKey || !this.sortBySortKey) {
          //Second sort criteria (priority)
          return a.priority - b.priority;
        }
        //First sort criteria (sortKey)
        return a.sortKey - b.sortKey;
      });
    }
    opaque = this.collection['opaque'];
  }

  //Sort transparent drawables
  if (this.collection['transparent'] !== undefined) {
    if (this.sortTrans) {
      this.collection['transparent'].sort(function(a,b) {
        if (a.sortKey == b.sortKey || !this.sortBySortKey) {
          if (a.priority == b.priority || !this.sortByPriority) {
            //Third sort criteria (zPos)
            return a.zPos - b.zPos;
          }
          //Second sort criteria (priority)
          return a.priority - b.priority;
        }	
        //First sort criteria (sortKey)
        return a.sortKey - b.sortKey;
      });
    }
    transparent = this.collection['transparent'];
  }
  
  //Merge opaque and transparent drawables to a single array (uhh, slow operation)
  this.collection = opaque.concat(transparent);
};
