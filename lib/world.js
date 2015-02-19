'use strict';

var extend = require('extend')
var ndarray = require('ndarray')
var inherits = require('inherits')
var EventEmitter = require('events').EventEmitter


module.exports = function(noa, opts) {
  return new World(noa, opts)
}


var defaultOptions = {
  generator: defaultGenerator,
  chunkSize: 16,
  chunkAddDistance: 2,
  chunkRemoveDistance: 3

}



function World(noa, _opts) {
  this.noa = noa
  var opts = extend( defaultOptions, _opts )

  this.chunkSize = opts.chunkSize
  this.generator = opts.generator
  this.chunkAddDistance = opts.chunkAddDistance
  this.chunkRemoveDistance = opts.chunkRemoveDistance

  // internals
  this._chunksToAdd = []
  this._chunksToRemove = []
  this._chunks = {}
}

inherits( World, EventEmitter )



/*
 *   PUBLIC API 
*/ 

World.prototype.getBlock = function (x,y,z) {
  var cs = this.chunkSize
  var i = Math.floor(x/cs)
  var j = Math.floor(y/cs)
  var k = Math.floor(z/cs)
  var chunk = this._chunks[ getChunkID(i,j,k) ]
  if (!chunk) return 0
  x = (x<0) ? x-i*cs : x%cs
  y = (y<0) ? y-j*cs : y%cs
  z = (z<0) ? z-k*cs : z%cs
  return chunk.get( x, y, z )
  // TODO: above bit could be made faster by constraining chunksize
  // to be a power of 2, and using math tricks from 
  // voxel - Chunker#voxelAtCoordinates
}


World.prototype.setBlock = function (id,x,y,z) {
  // TODO: revisit this to share code with getBlock, and send an 
  // event rather than calling into noa.
  var cs = this.chunkSize
  var i = Math.floor(x/cs)
  var j = Math.floor(y/cs)
  var k = Math.floor(z/cs)
  var chunk = this._chunks[ getChunkID(i,j,k) ]
  if (!chunk) return 0
  x = (x<0) ? x-i*cs : x%cs
  y = (y<0) ? y-j*cs : y%cs
  z = (z<0) ? z-k*cs : z%cs
  chunk.set( x, y, z, id )
  // alert world
  var cs = this.chunkSize
  this.emit( 'onChunkChanged', chunk, getChunkID(i,j,k), cs*i, cs*j, cs*k )
}



World.prototype.tick = function() {
  // check player position and needed/unneeded chunks
  var pos = this.noa.getPlayerPosition()
  var cs = this.chunkSize
  var i = Math.floor(pos[0]/cs)
  var j = Math.floor(pos[1]/cs)
  var k = Math.floor(pos[2]/cs)
  var chunkID = getChunkID( i,j,k )
  if (chunkID != this._lastPlayerChunkID) {
    updateChunkQueues( this, i, j, k )
  }
  this._lastPlayerChunkID = chunkID
  
  // remove a chunk if needed, else, add one if needed
  if (this._chunksToRemove.length) {
    var loc = this._chunksToRemove.shift()
    removeChunk( this, loc[0], loc[1], loc[2] )
  } else if (this._chunksToAdd.length) {
    var index = findClosestChunk( i, j, k, this._chunksToAdd )
    var loc = this._chunksToAdd.splice(index,1)[0]
    addNewChunk( this, loc[0], loc[1], loc[2] )
  }
}




/*
 *    INTERNALS
*/


// canonical string ID handling for the i,j,k-th chunk
function getChunkID( i, j, k ) {
  return [i, j, k].join('|')
}
function parseChunkID( id ) {
  var arr = id.split('|')
  return [ parseInt(arr[0]), parseInt(arr[1]), parseInt(arr[2]) ]
}


// add a new chunk to the world, based on string id
function addNewChunk( world, i, j, k ) {
  var id = getChunkID(i,j,k)
  var chunk = createChunk( world, i, j, k )
  world._chunks[id] = chunk
  // alert the world
  var cs = world.chunkSize
  world.emit( 'chunkAdded', chunk, id, cs*i, cs*j, cs*k )
//  world.noa.onChunkAdded( chunk, id, loc[0], loc[1], loc[2] )
}

function removeChunk( world, i, j, k ) {
  var id = getChunkID(i,j,k)
  // ndarrays have no dispose function, so nothing to destroy
  delete world._chunks[id]
  // alert the world
  world.emit( 'chunkRemoved', id )
}




// create a given chunk, using the world's generator and chunkSize
function createChunk( world, i, j, k ) {
  // create ndarray to hold the data
  var cs = world.chunkSize
  var arr = new Uint8Array(cs*cs*cs)
  var chunk = new ndarray( arr, [cs,cs,cs] )
  // pass it to generator for actual data generation
  var gen = world.generator
  world.generator( chunk, i*cs, j*cs, k*cs )
  return chunk
}



// check for needed/unneeded chunks around (ci,cj,ck)
function updateChunkQueues( world, ci, cj, ck ) {
  var chunks = world._chunks,
      add = world.chunkAddDistance,
      rem = world.chunkRemoveDistance,
      loc
  // enqueue chunks needing to be added
  for (var i=ci-add; i<=ci+add; ++i) {
    for (var j=cj-add; j<=cj+add; ++j) {
      for (var k=ck-add; k<=ck+add; ++k) {
        var id = getChunkID(i,j,k)
        if (chunks[id]) continue
        enqueueChunk( [i,j,k], world._chunksToAdd )
      }
    }
  }
  // enqueue chunks needing to be removed
  for (var s in world._chunks) {
    loc = parseChunkID(s)
    if ((Math.abs(loc[0]-ci) > rem) ||
        (Math.abs(loc[1]-cj) > rem) ||
        (Math.abs(loc[2]-ck) > rem)) {
      enqueueChunk( loc, world._chunksToRemove )
    }
  }
}


// enqueue an [i,j,k] chunk location into an array of them
function enqueueChunk( arr, queue ) {
  for (var i=0; i<queue.length; ++i) {
    var qarr = queue[i]
    if ( arr[0]==qarr[0] && arr[1]==qarr[1] && arr[2]==qarr[2] ) return
  }
  queue.push(arr)
}

// find index of nearest chunk in queue of [i,j,k] arrays
function findClosestChunk( ci, cj, ck, queue ) {
  var index = -1, dist = 10000
  for (var i=0; i<queue.length; ++i) {
    var qarr = queue[i]
    var d = Math.abs(qarr[0]-ci) + Math.abs(qarr[1]-cj) + Math.abs(qarr[2]-ck)
    if (d<dist) {
      dist = d
      index = i
    }
  }
  return index
}






// sample generator function
//   takes an empty chunk, and an x/y/z to start from
//   writes data into the chunk (ndarray)

function defaultGenerator( chunk, x, y, z ) {
  var dx = chunk.shape[0]
  var dy = chunk.shape[1]
  var dz = chunk.shape[2]
  // default case - just return 1/2 for everything below y=5
  for (var i=0; i<dx; ++i) {
    for (var j=0; j<dy; ++j) {
      for (var k=0; k<dz; ++k) {
        var cy = y + j
        var blockID = (cy<4) ? 1 : (cy==4) ? 2 : 0
        if (cy==5 && Math.random()>0.8)  blockID = 2
        chunk.set( i,j,k, blockID )
      }
    }
  }
}


