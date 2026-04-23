// ---------------------------------------------------------------------------
// MapGenerator — faithful JS port of MapGenerator.cs
// ---------------------------------------------------------------------------

const kShapes = [
  [1, 1], [1, 2], [1, 3], [1, 4],
  [2, 2], [2, 3], [2, 4],
];

const kColors = [
  BrickColor.Yellow, BrickColor.Red, BrickColor.Green, BrickColor.Blue,
];

const kFaceOffsets = [
  [1, 0, 0], [-1, 0, 0],
  [0, 1, 0], [0, -1, 0],
  [0, 0, 1], [0, 0, -1],
];

// --------------------------------------------------------------------------
// Public entry point
// --------------------------------------------------------------------------
function generate(
  seed, brickCount, minHeight, maxHeight, maxExtent,
  maxBricksPerLayer, forceConnected, difficulty, plateLength, plateWidth
) {
  const rng = new SeededRandom(seed);
  const placed = [];

  // Build 28-entry library: 7 shapes × 4 colors.
  const library = [];
  for (const [len, wid] of kShapes)
    for (const color of kColors)
      library.push(brickShape(len, wid, color));

  const clusterCount = Math.max(1, Math.min(difficulty, 3));

  // --- Single-cluster fast path ---
  if (clusterCount === 1) {
    const pegs = new Set();
    for (let x = 0; x < plateLength; x++)
      for (let z = 0; z < plateWidth; z++)
        pegs.add(vec3Key(x, 0, z));

    generateCluster(
      rng, library, placed, new Set(), new Set(), pegs, forceConnected,
      brickCount, minHeight, maxHeight, maxExtent, maxBricksPerLayer,
      plateLength, plateWidth
    );
    return placed;
  }

  // --- Multi-cluster path ---
  const seedPoints = pickClusterSeedPoints(rng, clusterCount, plateLength, plateWidth);

  const budget = Math.min(brickCount, library.length);
  const clusterBudget = [];
  for (let c = 0; c < clusterCount; c++)
    clusterBudget.push(Math.floor(budget / clusterCount) + (c < budget % clusterCount ? 1 : 0));

  const globalOccupied = new Set();

  for (let c = 0; c < clusterCount; c++) {
    const blocked = new Set();

    for (const cellKey of globalOccupied) {
      blocked.add(cellKey);
      const cell = keyToVec3(cellKey);
      for (const [ox, oy, oz] of kFaceOffsets)
        blocked.add(vec3Key(cell.x + ox, cell.y + oy, cell.z + oz));
    }

    for (let other = c + 1; other < clusterCount; other++) {
      const s = seedPoints[other];
      const sk = vec3Key(s.x, s.y, s.z);
      blocked.add(sk);
      for (const [ox, oy, oz] of kFaceOffsets)
        blocked.add(vec3Key(s.x + ox, s.y + oy, s.z + oz));
    }

    const pegs = new Set();
    pegs.add(vec3Key(seedPoints[c].x, seedPoints[c].y, seedPoints[c].z));
    const clusterOccupied = new Set();

    generateCluster(
      rng, library, placed, clusterOccupied, blocked, pegs,
      true, clusterBudget[c], minHeight, maxHeight, maxExtent,
      maxBricksPerLayer, plateLength, plateWidth
    );

    for (const k of clusterOccupied)
      globalOccupied.add(k);
  }

  return placed;
}

// --------------------------------------------------------------------------
// Internals
// --------------------------------------------------------------------------

function keyToVec3(key) {
  const z = (key & 0x3ff) - 512;
  const y = ((key >>> 10) & 0x3ff) - 512;
  const x = ((key >>> 20) & 0x3ff) - 512;
  return { x, y, z };
}

function pickClusterSeedPoints(rng, count, plateLength, plateWidth) {
  const seeds = [];
  const alignOnX = rng.next(2) === 0;
  const sharedCoord = alignOnX ? rng.next(plateLength) : rng.next(plateWidth);
  const secMax = alignOnX ? plateWidth : plateLength;

  for (let i = 0; i < count; i++) {
    const anchor = Math.floor((2 * i + 1) * secMax / (2 * count));
    seeds.push(
      alignOnX ? vec3From(sharedCoord, 0, anchor)
               : vec3From(anchor, 0, sharedCoord)
    );
  }
  return seeds;
}

function generateCluster(
  rng, library, placed, occupied, blocked, pegs, forceConnected,
  brickBudget, minHeight, maxHeight, maxExtent, maxBricksPerLayer,
  plateLength, plateWidth
) {
  const perLayerCount = new Map();
  let currentStackTop = 0;
  const limit = Math.min(brickBudget, library.length);

  for (let i = 0; i < limit; i++) {
    let chosen = null;
    let chosenLibIdx = -1;

    // Shuffle traversal order.
    const order = [];
    for (let j = 0; j < library.length; j++) order.push(j);
    for (let j = order.length - 1; j > 0; j--) {
      const k = rng.next(j + 1);
      [order[j], order[k]] = [order[k], order[j]];
    }

    for (const libIdx of order) {
      const shape = library[libIdx];

      let candidates = findPlacements(
        shape, pegs, occupied, blocked, plateLength, plateWidth,
        maxExtent, maxHeight, maxBricksPerLayer, perLayerCount
      );

      if (forceConnected && occupied.size > 0) {
        candidates = candidates.filter(c => touchesExisting(c, occupied));
      }

      if (candidates.length === 0) continue;

      // Climbing bias.
      if (minHeight > 0 && currentStackTop < minHeight) {
        let maxY = -Infinity;
        for (const c of candidates) if (c.y > maxY) maxY = c.y;
        const climbing = candidates.filter(c => c.y === maxY);
        if (climbing.length > 0) candidates = climbing;
      }

      chosen = candidates[rng.next(candidates.length)];
      chosenLibIdx = libIdx;
      break;
    }

    if (!chosen) break;

    placed.push(chosen);
    library.splice(chosenLibIdx, 1);

    perLayerCount.set(chosen.y, (perLayerCount.get(chosen.y) || 0) + 1);

    for (let dx = 0; dx < chosen.length; dx++) {
      for (let dz = 0; dz < chosen.width; dz++) {
        const cx = chosen.x + dx;
        const cy = chosen.y;
        const cz = chosen.z + dz;
        const cellKey = vec3Key(cx, cy, cz);
        occupied.add(cellKey);
        pegs.delete(cellKey);

        const aboveKey = vec3Key(cx, cy + 1, cz);
        if ((maxHeight <= 0 || cy + 1 < maxHeight) && !blocked.has(aboveKey))
          pegs.add(aboveKey);
      }
    }

    if (chosen.y + 1 > currentStackTop)
      currentStackTop = chosen.y + 1;
  }
}

function findPlacements(
  shape, pegs, occupied, blocked, plateLength, plateWidth,
  maxExtent, maxHeight, maxBricksPerLayer, perLayerCount
) {
  const results = [];
  const orientations =
    shape.length === shape.width
      ? [[shape.length, shape.width]]
      : [[shape.length, shape.width], [shape.width, shape.length]];

  for (const pegKey of pegs) {
    const peg = keyToVec3(pegKey);

    if (maxHeight > 0 && peg.y >= maxHeight) continue;
    if (maxBricksPerLayer > 0) {
      if ((perLayerCount.get(peg.y) || 0) >= maxBricksPerLayer) continue;
    }

    for (const [len, wid] of orientations) {
      for (let dx = 0; dx < len; dx++) {
        for (let dz = 0; dz < wid; dz++) {
          const x0 = peg.x - dx;
          const z0 = peg.z - dz;
          const y = peg.y;

          let rejected = false;
          for (let cx = 0; cx < len && !rejected; cx++) {
            for (let cz = 0; cz < wid && !rejected; cz++) {
              const k = vec3Key(x0 + cx, y, z0 + cz);
              if (occupied.has(k) || blocked.has(k)) {
                rejected = true;
              } else if (!withinExtent(x0 + cx, z0 + cz, plateLength, plateWidth, maxExtent)) {
                rejected = true;
              }
            }
          }
          if (rejected) continue;

          results.push(placedBrick(x0, y, z0, len, wid, shape.color));
        }
      }
    }
  }
  return results;
}

function withinExtent(x, z, plateLength, plateWidth, maxExtent) {
  if (maxExtent < 0) return true;
  const dx = x < 0 ? -x : (x >= plateLength ? x - plateLength + 1 : 0);
  const dz = z < 0 ? -z : (z >= plateWidth ? z - plateWidth + 1 : 0);
  return Math.max(dx, dz) <= maxExtent;
}

function touchesExisting(brick, occupied) {
  for (let dx = 0; dx < brick.length; dx++) {
    for (let dz = 0; dz < brick.width; dz++) {
      const cx = brick.x + dx;
      const cy = brick.y;
      const cz = brick.z + dz;

      for (const [ox, oy, oz] of kFaceOffsets) {
        const nx = cx + ox;
        const ny = cy + oy;
        const nz = cz + oz;

        // Skip cells inside this brick's own footprint.
        const isSelf = ny === cy &&
          nx >= brick.x && nx < brick.x + brick.length &&
          nz >= brick.z && nz < brick.z + brick.width;
        if (isSelf) continue;

        if (occupied.has(vec3Key(nx, ny, nz))) return true;
      }
    }
  }
  return false;
}
