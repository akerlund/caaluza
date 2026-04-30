// ---------------------------------------------------------------------------
// renderer3d.js — Three.js scene for the block structure
//
// Coordinate note: game uses Unity-style left-handed coords (+Z forward).
// Three.js is right-handed (+Z toward viewer). Without Z-negation the 3D
// view is left-right mirrored vs. what each player sees. All Z positions
// are therefore stored as −z_unity (wz helper).
//
// Requires THREE and THREE.OrbitControls from global scope (CDN scripts).
// ---------------------------------------------------------------------------

var STUD        = 1;
var BRICK_H     = 1;
var PLATE_H     = 0.35;
var STUD_RADIUS = 0.24;
var STUD_HEIGHT = 0.18;
var STUD_SEGS   = 12;

var COLOR_MAP = {};
COLOR_MAP[BrickColor.Yellow] = 0xf5c542;
COLOR_MAP[BrickColor.Red]    = 0xd42020;
COLOR_MAP[BrickColor.Green]  = 0x2d8e2d;
COLOR_MAP[BrickColor.Blue]   = 0x2060c0;
var PLATE_COLOR = 0x888888;

// wz: converts Unity Z to Three.js Z (negated).
function wz(z) { return -z; }

var _studGeo  = null;
var _renderer, _scene, _camera, _controls, _dirLight;
var _captureRenderer = null;
var _captureCamera = null;
var _backgroundTexture = null;
var _resizeObserver = null;
var _liveBackgroundMode = 'black';

function getCaptureRenderer(size) {
  if (!_captureRenderer) {
    _captureRenderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    _captureRenderer.setPixelRatio(1);
    _captureRenderer.shadowMap.enabled = true;
    _captureRenderer.shadowMap.type = THREE.PCFSoftShadowMap;
    _captureRenderer.toneMapping = THREE.ACESFilmicToneMapping;
    _captureRenderer.toneMappingExposure = 1.0;
  }
  _captureRenderer.setSize(size, size);
  return _captureRenderer;
}

function getCaptureCamera(fov) {
  if (!_captureCamera)
    _captureCamera = new THREE.PerspectiveCamera(fov, 1, 0.1, 500);
  _captureCamera.fov = fov;
  _captureCamera.aspect = 1;
  _captureCamera.near = 0.1;
  _captureCamera.far = 500;
  _captureCamera.updateProjectionMatrix();
  return _captureCamera;
}

function getSceneBackgroundTexture() {
  if (_backgroundTexture) return _backgroundTexture;

  var size = 768;
  var canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  var ctx = canvas.getContext('2d');

  // More pronounced blue gradient and glow
  var base = ctx.createLinearGradient(0, 0, 0, size);
  base.addColorStop(0, '#1b2e4a');
  base.addColorStop(0.35, '#18305a');
  base.addColorStop(0.7, '#0e1a2a');
  base.addColorStop(1, '#070b11');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);

  // Stronger blue glow
  var glow = ctx.createRadialGradient(size * 0.5, size * 0.26, size * 0.06, size * 0.5, size * 0.26, size * 0.62);
  glow.addColorStop(0, 'rgba(118, 178, 255, 0.38)');
  glow.addColorStop(0.3, 'rgba(59, 106, 176, 0.22)');
  glow.addColorStop(0.7, 'rgba(0, 40, 80, 0.10)');
  glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, size, size);

  // Subtle color shift at horizon
  var horizon = ctx.createLinearGradient(0, size * 0.5, 0, size * 0.88);
  horizon.addColorStop(0, 'rgba(0, 0, 0, 0)');
  horizon.addColorStop(0.22, 'rgba(110, 154, 214, 0.10)');
  horizon.addColorStop(0.5, 'rgba(73, 110, 168, 0.22)');
  horizon.addColorStop(0.85, 'rgba(12, 18, 28, 0.44)');
  horizon.addColorStop(1, 'rgba(7, 11, 17, 0.82)');
  ctx.fillStyle = horizon;
  ctx.fillRect(0, size * 0.5, size, size * 0.38);

  ctx.strokeStyle = 'rgba(190, 224, 255, 0.10)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(size * 0.1, size * 0.7);
  ctx.quadraticCurveTo(size * 0.5, size * 0.62, size * 0.9, size * 0.7);
  ctx.stroke();

  for (var i = 0; i < 1400; i++) {
    var x = Math.random() * size;
    var y = Math.random() * size;
    var alpha = y > size * 0.7 ? 0.018 : 0.032;
    ctx.fillStyle = 'rgba(255,255,255,' + alpha + ')';
    ctx.fillRect(x, y, 1, 1);
  }

  var vignette = ctx.createRadialGradient(size * 0.5, size * 0.5, size * 0.22, size * 0.5, size * 0.5, size * 0.72);
  vignette.addColorStop(0, 'rgba(0, 0, 0, 0)');
  vignette.addColorStop(1, 'rgba(0, 0, 0, 0.46)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, size, size);

  _backgroundTexture = new THREE.CanvasTexture(canvas);
  _backgroundTexture.encoding = THREE.sRGBEncoding;
  return _backgroundTexture;
}

function applyLiveBackgroundMode() {
  if (!_scene) return;

  if (_liveBackgroundMode === 'atmospheric') {
    _scene.background = getSceneBackgroundTexture();
    // Denser, more visible fog for effect
    _scene.fog = new THREE.Fog(0x18305a, 18, 44);
  } else {
    _scene.background = new THREE.Color(0x000000);
    _scene.fog = null;
  }
}

function setLiveBackgroundMode(mode) {
  _liveBackgroundMode = mode === 'atmospheric' ? 'atmospheric' : 'black';
  applyLiveBackgroundMode();
}

function syncRendererSize(container) {
  if (!_renderer || !_camera || !container) return;

  var width = Math.max(1, Math.floor(container.clientWidth));
  var height = Math.max(1, Math.floor(container.clientHeight));

  _camera.aspect = width / height;
  _camera.updateProjectionMatrix();
  _renderer.setSize(width, height, false);
}

function init3D(container) {
  _renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  _renderer.setPixelRatio(window.devicePixelRatio);
  _renderer.domElement.style.width = '100%';
  _renderer.domElement.style.height = '100%';
  _renderer.shadowMap.enabled    = true;
  _renderer.shadowMap.type       = THREE.PCFSoftShadowMap;
  _renderer.toneMapping          = THREE.ACESFilmicToneMapping;
  _renderer.toneMappingExposure  = 1.0;
  container.appendChild(_renderer.domElement);
  syncRendererSize(container);

  _scene = new THREE.Scene();
  applyLiveBackgroundMode();

  _camera = new THREE.PerspectiveCamera(50, container.clientWidth / container.clientHeight, 0.1, 500);
  _camera.position.set(12, 10, 12);

  _controls = new THREE.OrbitControls(_camera, _renderer.domElement);
  _controls.enableDamping = true;

  // Hemisphere light: warm sky above, cool-grey ground bounce.
  _scene.add(new THREE.HemisphereLight(0xfff4e0, 0x8090a0, 0.75));

  // Directional light with soft shadows.
  _dirLight = new THREE.DirectionalLight(0xffffff, 0.9);
  _dirLight.position.set(10, 20, 10);
  _dirLight.castShadow = true;
  _dirLight.shadow.mapSize.width  = 2048;
  _dirLight.shadow.mapSize.height = 2048;
  _dirLight.shadow.camera.near   = 0.5;
  _dirLight.shadow.camera.far    = 120;
  _dirLight.shadow.camera.left   = -40;
  _dirLight.shadow.camera.right  =  40;
  _dirLight.shadow.camera.top    =  40;
  _dirLight.shadow.camera.bottom = -40;
  _dirLight.shadow.bias          = -0.001;
  _scene.add(_dirLight);

  (function animate() {
    requestAnimationFrame(animate);
    _controls.update();
    _renderer.render(_scene, _camera);
  })();

  window.addEventListener('resize', function() {
    syncRendererSize(container);
  });

  if (typeof ResizeObserver === 'function') {
    if (_resizeObserver) _resizeObserver.disconnect();
    _resizeObserver = new ResizeObserver(function() {
      syncRendererSize(container);
    });
    _resizeObserver.observe(container);
  }
}

window.setLiveBackgroundMode = setLiveBackgroundMode;

// Plastic-looking standard material for block bodies.
function plasticMat(color) {
  return new THREE.MeshStandardMaterial({ color: color, roughness: 0.35, metalness: 0.05 });
}

// Shinier material for studs — catches light like real block nubs.
function studMat(color) {
  return new THREE.MeshStandardMaterial({ color: color, roughness: 0.15, metalness: 0.10 });
}

// Auto-spin: rotate ~90° over ~1 s on each new build.
var _spinTimeout = null;
function triggerSpin() {
  _controls.autoRotate      = true;
  _controls.autoRotateSpeed = 8;
  if (_spinTimeout) clearTimeout(_spinTimeout);
  _spinTimeout = setTimeout(function() {
    _controls.autoRotate = false;
    _spinTimeout = null;
  }, 1000);
}

// --------------------------------------------------------------------------
// makeNameSprite — billboard label that always faces the camera.
// --------------------------------------------------------------------------
function makeNameSprite(name) {
  var W = 256, H = 72;
  var canvas = document.createElement('canvas');
  canvas.width  = W;
  canvas.height = H;
  var ctx = canvas.getContext('2d');

  // Dark pill background.
  var r = 12;
  ctx.fillStyle = 'rgba(20,20,20,0.78)';
  ctx.beginPath();
  ctx.moveTo(r, 0);
  ctx.lineTo(W - r, 0);
  ctx.arcTo(W, 0, W, r, r);
  ctx.lineTo(W, H - r);
  ctx.arcTo(W, H, W - r, H, r);
  ctx.lineTo(r, H);
  ctx.arcTo(0, H, 0, H - r, r);
  ctx.lineTo(0, r);
  ctx.arcTo(0, 0, r, 0, r);
  ctx.closePath();
  ctx.fill();

  ctx.font = 'bold 36px Arial,sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(name, W / 2, H / 2);

  var tex = new THREE.Texture(canvas);
  tex.needsUpdate = true;

  var mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
  var sprite = new THREE.Sprite(mat);
  var worldH = 1.6;
  sprite.scale.set(worldH * (W / H), worldH, 1);
  return sprite;
}

function buildScene(bricks, plateLength, plateWidth, playerCount) {
  playerCount = playerCount !== undefined ? playerCount : 4;

  // Remove all meshes and sprites from previous build.
  var toRemove = [];
  var matsToDispose = new Set();
  var geosToDispose = new Set();
  _scene.traverse(function(obj) {
    if (obj.isMesh || obj.isSprite) toRemove.push(obj);
  });
  for (var i = 0; i < toRemove.length; i++) {
    var obj = toRemove[i];
    if (obj.geometry && obj.geometry !== _studGeo)
      geosToDispose.add(obj.geometry);
    if (obj.material) {
      if (Array.isArray(obj.material)) {
        for (var mi = 0; mi < obj.material.length; mi++)
          matsToDispose.add(obj.material[mi]);
      } else {
        matsToDispose.add(obj.material);
      }
    }
    _scene.remove(obj);
  }

  geosToDispose.forEach(function(geo) { geo.dispose(); });
  matsToDispose.forEach(function(mat) {
    if (mat.map) mat.map.dispose();
    mat.dispose();
  });

  if (!_studGeo)
    _studGeo = new THREE.CylinderGeometry(STUD_RADIUS, STUD_RADIUS, STUD_HEIGHT, STUD_SEGS);

  // Plate center (Z negated).
  var wxC  = (plateLength / 2 - 0.5) * STUD;
  var wzC  = wz((plateWidth  / 2 - 0.5) * STUD);
  var halfX = plateLength / 2 * STUD;
  var halfZ = plateWidth  / 2 * STUD;

  // Base plate.
  var plateMat  = plasticMat(PLATE_COLOR);
  var plateGeo  = new THREE.BoxGeometry(plateLength * STUD, PLATE_H, plateWidth * STUD);
  var plateMesh = new THREE.Mesh(plateGeo, plateMat);
  plateMesh.position.set(wxC, -PLATE_H / 2, wzC);
  plateMesh.castShadow    = true;
  plateMesh.receiveShadow = true;
  _scene.add(plateMesh);

  // Plate studs.
  var plateStudMat = studMat(PLATE_COLOR);
  for (var sx = 0; sx < plateLength; sx++) {
    for (var sz = 0; sz < plateWidth; sz++) {
      var ps = new THREE.Mesh(_studGeo, plateStudMat);
      ps.position.set(sx * STUD, STUD_HEIGHT / 2, wz(sz * STUD));
      ps.castShadow    = true;
      ps.receiveShadow = true;
      _scene.add(ps);
    }
  }

  // Occupied set (Unity coords) for stud-hiding.
  var occupied = {};
  for (var bi = 0; bi < bricks.length; bi++) {
    var b = bricks[bi];
    for (var dx = 0; dx < b.length; dx++)
      for (var dz = 0; dz < b.width; dz++)
        occupied[(b.x+dx)+','+(b.y)+','+(b.z+dz)] = true;
  }

  // Bricks + studs.
  for (var bi = 0; bi < bricks.length; bi++) {
    var b    = bricks[bi];
    var col  = COLOR_MAP[b.color] !== undefined ? COLOR_MAP[b.color] : 0xff00ff;
    var mat  = plasticMat(col);
    var geo  = new THREE.BoxGeometry(b.length * STUD, BRICK_H, b.width * STUD);
    var mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(
      (b.x + b.length / 2 - 0.5) * STUD,
      b.y * BRICK_H + BRICK_H / 2,
      wz((b.z + b.width / 2 - 0.5) * STUD)
    );
    mesh.castShadow    = true;
    mesh.receiveShadow = true;
    _scene.add(mesh);

    var smat = studMat(col);
    for (var dx = 0; dx < b.length; dx++) {
      for (var dz = 0; dz < b.width; dz++) {
        if (occupied[(b.x+dx)+','+(b.y+1)+','+(b.z+dz)]) continue;
        var st = new THREE.Mesh(_studGeo, smat);
        st.position.set(
          (b.x + dx) * STUD,
          (b.y + 1) * BRICK_H + STUD_HEIGHT / 2,
          wz((b.z + dz) * STUD)
        );
        st.castShadow    = true;
        st.receiveShadow = true;
        _scene.add(st);
      }
    }
  }

  // --------------------------------------------------------------------------
  // Player name labels — one sprite per side, placed just outside the plate.
  // In Three.js coords (Z negated from Unity):
  //   P1 Caaluza at -Z Unity → +Z Three.js: near edge (large +Z)
  //   P2 Oedan   at +X Unity → +X Three.js: right edge
  //   P3 Sigarus at +Z Unity → -Z Three.js: far edge (large -Z)
  //   P4 Alx     at -X Unity → -X Three.js: left edge
  // --------------------------------------------------------------------------
  var margin   = 2.2;
  var labelY   = -(PLATE_H + 0.8);  // below plate bottom (sprite centre)
  var names    = ['Caaluza', 'Oedan', 'Sigarus', 'Alx'];
  var labelPos = [
    [wxC,                  labelY, wzC + halfZ + margin],  // P1 +Z
    [wxC + halfX + margin, labelY, wzC                ],   // P2 +X
    [wxC,                  labelY, wzC - halfZ - margin],  // P3 -Z
    [wxC - halfX - margin, labelY, wzC                ],   // P4 -X
  ];

  for (var pi = 0; pi < playerCount; pi++) {
    var sp = makeNameSprite(names[pi]);
    sp.position.set(labelPos[pi][0], labelPos[pi][1], labelPos[pi][2]);
    _scene.add(sp);
  }

  // Move shadow light target to plate centre so shadows fall correctly.
  _dirLight.target.position.set(wxC, 0, wzC);
  _dirLight.target.updateMatrixWorld();

  // Camera: pull back far enough to frame plate + labels.
  var span    = Math.max(plateLength, plateWidth) + margin * 2;
  var camDist = span * 1.1;
  var camH    = span * 0.7;
  var target  = new THREE.Vector3(wxC, 1, wzC);
  _controls.target.copy(target);
  _camera.position.set(target.x + camDist, camH, target.z + camDist);
  _controls.update();

  triggerSpin();
}

// --------------------------------------------------------------------------
// captureCornerSnapshots — one per player, corner views (no labels).
// --------------------------------------------------------------------------
function captureCornerSnapshots(plateLength, plateWidth, playerCount) {
  if (!_scene) return [];

  playerCount = playerCount !== undefined ? playerCount : 4;
  var wxC  = (plateLength / 2 - 0.5) * STUD;
  var wzC  = wz((plateWidth  / 2 - 0.5) * STUD);
  var tgt  = new THREE.Vector3(wxC, 1, wzC);
  var dist = Math.max(plateLength, plateWidth) * 1.4;
  var h    = dist * 0.6;

  var corners = [
    new THREE.Vector3(wxC - dist, h, wzC + dist),  // P1
    new THREE.Vector3(wxC + dist, h, wzC + dist),  // P2
    new THREE.Vector3(wxC + dist, h, wzC - dist),  // P3
    new THREE.Vector3(wxC - dist, h, wzC - dist),  // P4
  ];

  var sz  = 512;
  var off = getCaptureRenderer(sz);
  var cam = getCaptureCamera(45);
  var results = [];
  var previousBackground = _scene.background;
  var previousFog = _scene.fog;
  var previousClearColor = new THREE.Color();
  off.getClearColor(previousClearColor);
  var previousClearAlpha = off.getClearAlpha();

  _scene.background = null;
  _scene.fog = null;
  off.setClearColor(0xffffff, 1);

  try {
    for (var i = 0; i < playerCount; i++) {
      cam.position.copy(corners[i]);
      cam.lookAt(tgt);
      off.render(_scene, cam);
      results.push(off.domElement.toDataURL('image/png'));
    }
  } finally {
    _scene.background = previousBackground;
    _scene.fog = previousFog;
    off.setClearColor(previousClearColor, previousClearAlpha);
  }

  return results;
}

// --------------------------------------------------------------------------
// captureHeroSnapshot — high-res isometric render for the PDF overview page.
// --------------------------------------------------------------------------
function captureHeroSnapshot(plateLength, plateWidth) {
  if (!_scene) return '';

  var wxC  = (plateLength / 2 - 0.5) * STUD;
  var wzC  = wz((plateWidth  / 2 - 0.5) * STUD);
  var tgt  = new THREE.Vector3(wxC, 0.5, wzC);
  var span = Math.max(plateLength, plateWidth);
  var dist = span * 1.7;
  var h    = dist * 0.7;

  var sz  = 1024;
  var off = getCaptureRenderer(sz);
  var cam = getCaptureCamera(38);
  cam.position.set(wxC + dist * 0.75, h, wzC + dist * 0.75);
  cam.lookAt(tgt);
  off.render(_scene, cam);
  var result = off.domElement.toDataURL('image/png');
  return result;
}
