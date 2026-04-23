// ---------------------------------------------------------------------------
// Blueprint — faithful JS port of Blueprint.cs
// Produces a 2D silhouette grid and rasterizes it onto a <canvas>.
// ---------------------------------------------------------------------------

const ViewDirection = Object.freeze({
  FromMinusZ: 0, // player 1 — looks +Z
  FromPlusX:  1, // player 2 — looks -X
  FromPlusZ:  2, // (unused legacy slot)
  FromMinusX: 3, // player 4 — looks +X
  FromAbove:  4, // player 3 — top-down plan view
});

const kOwnerNone  = -2;
const kOwnerPlate = -1;

function playerIndexToView(idx) {
  switch (idx) {
    case 1: return ViewDirection.FromMinusZ;
    case 2: return ViewDirection.FromPlusX;
    case 3: return ViewDirection.FromAbove;
    default: return ViewDirection.FromMinusX;
  }
}

// --------------------------------------------------------------------------
// createForPlayer — public factory
// brickPalette: Map<BrickColor, {r,g,b,a}> (0–255 channels)
// plateBodyColor / plateStudColor: {r,g,b,a}
// Returns a Blueprint object with .drawToCanvas(canvas, cellPixels, paper, outline, outlineThickness)
// --------------------------------------------------------------------------
function createForPlayer(
  playerIndex, seed, bricks, plateLength, plateWidth,
  brickPalette, plateBodyColor, plateStudColor
) {
  const bp = {
    playerIndex,
    seed,
    viewDirection: playerIndexToView(playerIndex),
    brickCount: bricks ? bricks.length : 0,
    isTopDown: false,
    cells: null,
    widthCells: 0,
    heightCells: 0,
    horizontalMin: 0,
  };

  bp.isTopDown = bp.viewDirection === ViewDirection.FromAbove;

  compute(bp, bricks, plateLength, plateWidth, brickPalette, plateBodyColor, plateStudColor);

  bp.drawToCanvas = function (canvas, cellPixels, paper, outline, outlineThickness) {
    cellPixels      = cellPixels      !== undefined ? cellPixels      : 24;
    paper           = paper           !== undefined ? paper           : {r:255,g:250,b:240,a:255};
    outline         = outline         !== undefined ? outline         : {r:40,g:40,b:40,a:255};
    outlineThickness = outlineThickness !== undefined ? outlineThickness : 1;
    renderToCanvas(bp, canvas, cellPixels, paper, outline, outlineThickness);
  };

  return bp;
}

// --------------------------------------------------------------------------
// compute — dispatches to top-down or side-view builder
// --------------------------------------------------------------------------
function compute(bp, bricks, plateLength, plateWidth, brickPalette, plateBodyColor, plateStudColor) {
  if (bp.isTopDown) {
    computeTopDown(bp, bricks, plateLength, plateWidth, brickPalette, plateBodyColor, plateStudColor);
    return;
  }

  const vd = bp.viewDirection;
  const useX = vd === ViewDirection.FromMinusZ || vd === ViewDirection.FromPlusZ;
  const flip = vd === ViewDirection.FromPlusZ || vd === ViewDirection.FromMinusX;
  const scanForward = vd === ViewDirection.FromMinusZ || vd === ViewDirection.FromMinusX;

  const plateHorizSpan = useX ? plateLength : plateWidth;
  const plateDepthSpan = useX ? plateWidth : plateLength;

  const bounds = computeBounds(bricks, useX, plateHorizSpan, plateDepthSpan);
  bp.horizontalMin = bounds.horizMin;
  bp.widthCells = bounds.horizMax - bounds.horizMin + 1;

  const blockRows = bounds.maxY + 1;
  bp.heightCells = 1 + blockRows + 1;

  const cells = [];
  for (let y = 0; y < bp.heightCells; y++) {
    const row = [];
    for (let x = 0; x < bp.widthCells; x++)
      row.push({ bodyOwner: kOwnerNone, bodyColor: null, studOwner: kOwnerNone, studColor: null });
    cells.push(row);
  }
  bp.cells = cells;

  const occupied = new Map();
  if (bricks) {
    for (let i = 0; i < bricks.length; i++) {
      const b = bricks[i];
      for (let dx = 0; dx < b.length; dx++)
        for (let dz = 0; dz < b.width; dz++)
          occupied.set(vec3Key(b.x + dx, b.y, b.z + dz), i);
    }
  }

  const colToHoriz = function(col) {
    const unflipped = col + bp.horizontalMin;
    return flip ? (bp.widthCells - 1 - col) + bp.horizontalMin : unflipped;
  };

  // Row 0: plate body strip
  for (let col = 0; col < bp.widthCells; col++) {
    const h = colToHoriz(col);
    if (h >= 0 && h < plateHorizSpan) {
      cells[0][col].bodyOwner = kOwnerPlate;
      cells[0][col].bodyColor = plateBodyColor;
    }
  }

  // Rows 1..heightCells-1
  for (let row = 1; row < bp.heightCells; row++) {
    const bodyLayer = row - 1;
    const studLayer = row - 2;
    const bodyLayerValid = bodyLayer <= bounds.maxY;

    for (let col = 0; col < bp.widthCells; col++) {
      const h = colToHoriz(col);
      cells[row][col] = scanCell(
        bodyLayer, bodyLayerValid, studLayer, h,
        bounds.depthMin, bounds.depthMax,
        plateHorizSpan, plateDepthSpan, scanForward, useX,
        occupied, bricks, brickPalette, plateStudColor
      );
    }
  }
}

// --------------------------------------------------------------------------
// computeTopDown — plan view for player 3 (FromAbove)
// --------------------------------------------------------------------------
function computeTopDown(bp, bricks, plateLength, plateWidth, brickPalette, plateBodyColor, plateStudColor) {
  const b = computeTopDownBounds(bricks, plateLength, plateWidth);
  const xMin = b.xMin, xMax = b.xMax, zMin = b.zMin, zMax = b.zMax;

  bp.horizontalMin = xMin;
  bp.widthCells    = xMax - xMin + 1;
  bp.heightCells   = zMax - zMin + 1;

  const cells = [];
  for (let row = 0; row < bp.heightCells; row++) {
    const rowArr = [];
    for (let col = 0; col < bp.widthCells; col++)
      rowArr.push({ bodyOwner: kOwnerNone, bodyColor: null, studOwner: kOwnerNone, studColor: null });
    cells.push(rowArr);
  }
  bp.cells = cells;

  // Topmost brick at each (x,z).
  const topVisible = new Map();
  if (bricks) {
    for (let i = 0; i < bricks.length; i++) {
      const br = bricks[i];
      for (let dx = 0; dx < br.length; dx++) {
        for (let dz = 0; dz < br.width; dz++) {
          const key = (br.x + dx) + ',' + (br.z + dz);
          if (!topVisible.has(key) || bricks[topVisible.get(key)].y < br.y)
            topVisible.set(key, i);
        }
      }
    }
  }

  for (let row = 0; row < bp.heightCells; row++) {
    // row 0 = near edge (+Z), largest Z first
    const z = (bp.heightCells - 1 - row) + zMin;
    for (let col = 0; col < bp.widthCells; col++) {
      // flip=true: col 0 = +X (P3's left)
      const x = (bp.widthCells - 1 - col) + xMin;
      cells[row][col] = buildTopDownCell(
        x, z, plateLength, plateWidth, topVisible, bricks, brickPalette,
        plateBodyColor, plateStudColor
      );
    }
  }
}

function computeTopDownBounds(bricks, plateLength, plateWidth) {
  let xMin = 0, xMax = plateLength - 1;
  let zMin = 0, zMax = plateWidth - 1;
  if (bricks) {
    for (let i = 0; i < bricks.length; i++) {
      const br = bricks[i];
      const bxMax = br.x + br.length - 1;
      const bzMax = br.z + br.width - 1;
      if (br.x  < xMin) xMin = br.x;
      if (bxMax > xMax) xMax = bxMax;
      if (br.z  < zMin) zMin = br.z;
      if (bzMax > zMax) zMax = bzMax;
    }
  }
  return { xMin, xMax, zMin, zMax };
}

function buildTopDownCell(x, z, plateLength, plateWidth, topVisible, bricks, brickPalette, plateBodyColor, plateStudColor) {
  const onPlate = x >= 0 && x < plateLength && z >= 0 && z < plateWidth;
  const cell = { bodyOwner: kOwnerNone, bodyColor: null, studOwner: kOwnerNone, studColor: null };

  if (onPlate) {
    cell.bodyOwner = kOwnerPlate;
    cell.bodyColor = plateBodyColor;
    cell.studOwner = kOwnerPlate;
    cell.studColor = plateStudColor;
  }

  const key = x + ',' + z;
  if (topVisible.has(key)) {
    const ix = topVisible.get(key);
    const color = brickPalette.get(bricks[ix].color);
    cell.bodyOwner = ix;
    cell.bodyColor = color;
    cell.studOwner = ix;
    cell.studColor = color;
  }

  return cell;
}

function scanCell(
  bodyLayer, bodyLayerValid, studLayer, h, depthMin, depthMax,
  plateHorizSpan, plateDepthSpan, scanForward, useX,
  occupied, bricks, brickPalette, plateStudColor
) {
  const start = scanForward ? depthMin : depthMax;
  const end   = scanForward ? depthMax : depthMin;
  const step  = scanForward ? 1 : -1;

  let bodyStep = -1, bodyOwner = kOwnerNone, bodyColor = null;
  let studStep = -1, studOwner = kOwnerNone, studColor = null;
  const horizOnPlate = h >= 0 && h < plateHorizSpan;
  let scanIndex = 0;

  for (let d = start; ; d += step, scanIndex++) {
    if (bodyLayerValid && bodyStep === -1) {
      const key = useX ? vec3Key(h, bodyLayer, d) : vec3Key(d, bodyLayer, h);
      if (occupied.has(key)) {
        const ix = occupied.get(key);
        bodyStep  = scanIndex;
        bodyOwner = ix;
        bodyColor = brickPalette.get(bricks[ix].color);
      }
    }

    if (studStep === -1) {
      if (studLayer === -1) {
        if (horizOnPlate && d >= 0 && d < plateDepthSpan) {
          studStep  = scanIndex;
          studOwner = kOwnerPlate;
          studColor = plateStudColor;
        }
      } else if (studLayer >= 0) {
        const key = useX ? vec3Key(h, studLayer, d) : vec3Key(d, studLayer, h);
        if (occupied.has(key)) {
          const ix = occupied.get(key);
          studStep  = scanIndex;
          studOwner = ix;
          studColor = brickPalette.get(bricks[ix].color);
        }
      }
    }

    if (d === end) break;
  }

  if (studStep !== -1 && bodyStep !== -1 && studStep >= bodyStep)
    studOwner = kOwnerNone;

  return { bodyOwner, bodyColor, studOwner, studColor };
}

function computeBounds(bricks, useX, plateHorizSpan, plateDepthSpan) {
  let horizMin = 0, horizMax = plateHorizSpan - 1;
  let depthMin = 0, depthMax = plateDepthSpan - 1;
  let maxY = 0;

  if (bricks) {
    for (let i = 0; i < bricks.length; i++) {
      const b = bricks[i];
      const hLo = useX ? b.x : b.z;
      const hHi = hLo + (useX ? b.length : b.width) - 1;
      const dLo = useX ? b.z : b.x;
      const dHi = dLo + (useX ? b.width : b.length) - 1;

      if (hLo < horizMin) horizMin = hLo;
      if (hHi > horizMax) horizMax = hHi;
      if (dLo < depthMin) depthMin = dLo;
      if (dHi > depthMax) depthMax = dHi;
      if (b.y > maxY) maxY = b.y;
    }
  }

  return { horizMin, horizMax, depthMin, depthMax, maxY };
}

// --------------------------------------------------------------------------
// renderToCanvas
// --------------------------------------------------------------------------
function renderToCanvas(bp, canvas, cellPixels, paper, outline, outlineThickness) {
  const cellSize = Math.max(1, cellPixels);
  const texW = bp.widthCells * cellSize;
  const texH = bp.heightCells * cellSize;

  canvas.width  = texW;
  canvas.height = texH;
  const ctx = canvas.getContext('2d');

  const toCSS = function(c) {
    return 'rgba(' + c.r + ',' + c.g + ',' + c.b + ',' + ((c.a !== undefined ? c.a : 255) / 255) + ')';
  };

  ctx.fillStyle = toCSS(paper);
  ctx.fillRect(0, 0, texW, texH);

  // Grid row 0 = bottom of canvas (plate / near edge).
  const cy = function(gridRow) { return (bp.heightCells - 1 - gridRow) * cellSize; };

  // Pass 1: body fills.
  for (let y = 0; y < bp.heightCells; y++) {
    for (let x = 0; x < bp.widthCells; x++) {
      const c = bp.cells[y][x];
      if (c.bodyOwner === kOwnerNone) continue;
      ctx.fillStyle = toCSS(c.bodyColor);
      ctx.fillRect(x * cellSize, cy(y), cellSize, cellSize);
    }
  }

  // Pass 2: body outlines.
  const edge = Math.min(outlineThickness, Math.floor(cellSize / 2));
  if (edge > 0) {
    for (let y = 0; y < bp.heightCells; y++) {
      for (let x = 0; x < bp.widthCells; x++) {
        const c = bp.cells[y][x];
        if (c.bodyOwner === kOwnerNone) continue;

        const px0   = x * cellSize;
        const py0   = cy(y);
        const owner = c.bodyOwner;

        const leftOwner  = x > 0                 ? bp.cells[y][x - 1].bodyOwner : kOwnerNone - 1;
        const rightOwner = x < bp.widthCells - 1  ? bp.cells[y][x + 1].bodyOwner : kOwnerNone - 1;
        const botOwner   = y > 0                  ? bp.cells[y - 1][x].bodyOwner : kOwnerNone - 1;
        const topOwner   = y < bp.heightCells - 1 ? bp.cells[y + 1][x].bodyOwner : kOwnerNone - 1;

        ctx.fillStyle = toCSS(outline);
        if (leftOwner  !== owner) ctx.fillRect(px0,                   py0,                   edge,     cellSize);
        if (rightOwner !== owner) ctx.fillRect(px0 + cellSize - edge, py0,                   edge,     cellSize);
        if (botOwner   !== owner) ctx.fillRect(px0,                   py0 + cellSize - edge, cellSize, edge);
        if (topOwner   !== owner) ctx.fillRect(px0,                   py0,                   cellSize, edge);
      }
    }
  }

  // Pass 3: studs.
  const isTopDown   = bp.isTopDown;
  const studMinEdge = Math.max(1, edge * 2 + 1);
  const studW  = Math.max(studMinEdge, Math.round(cellSize * 0.40));
  const studH  = isTopDown ? studW : Math.max(studMinEdge, Math.round(cellSize * 0.25));
  const studXOff = Math.floor((cellSize - studW) / 2);
  const studYOff = isTopDown ? Math.floor((cellSize - studH) / 2) : 0;

  for (let y = 0; y < bp.heightCells; y++) {
    for (let x = 0; x < bp.widthCells; x++) {
      const c = bp.cells[y][x];
      if (c.studOwner === kOwnerNone) continue;

      const sx = x * cellSize + studXOff;
      const sy = isTopDown ? cy(y) + studYOff : cy(y) + cellSize - studH;

      ctx.fillStyle = toCSS(c.studColor);
      ctx.fillRect(sx, sy, studW, studH);

      if (edge > 0) {
        ctx.fillStyle = toCSS(outline);
        ctx.fillRect(sx,               sy,               edge,  studH);
        ctx.fillRect(sx + studW - edge, sy,               edge,  studH);
        ctx.fillRect(sx,               sy,               studW, edge);
        ctx.fillRect(sx,               sy + studH - edge, studW, edge);
      }
    }
  }
}
