// ---------------------------------------------------------------------------
// Puzzle analyzer
// Estimates how many moves a player needs by repeatedly choosing the most
// constrained remaining brick and counting how many valid placements must be
// tried before the target placement is reached.
// ---------------------------------------------------------------------------

function analyzePuzzle(bricks, options) {
  options = options || {};

  const playerCount = Math.max(1, Math.min(4, options.playerCount || 4));
  const plateLength = options.plateLength || 8;
  const plateWidth = options.plateWidth || 8;
  const maxAnalysisMs = options.maxAnalysisMs !== undefined ? options.maxAnalysisMs : Math.max(120, bricks.length * 15);
  const targetBricks = [];

  for (let i = 0; i < bricks.length; i++) {
    targetBricks.push({
      id: i,
      x: bricks[i].x,
      y: bricks[i].y,
      z: bricks[i].z,
      length: bricks[i].length,
      width: bricks[i].width,
      color: bricks[i].color,
    });
  }

  const bounds = computeAnalysisBounds(targetBricks, plateLength, plateWidth);
  const targetViews = buildTargetViews(targetBricks, playerCount);
  const pieceStates = createAnalysisPieceStates(targetBricks);
  const steps = [];
  const safetyLimit = Math.max(40, targetBricks.length * 40);
  const analysisBudget = {
    deadlineMs: maxAnalysisMs > 0 ? Date.now() + maxAnalysisMs : Number.POSITIVE_INFINITY,
    timedOut: false,
  };

  let moveCount = 0;
  let forcedPlacements = 0;
  let ambiguousPlacements = 0;
  let maxCandidateCount = 0;
  let totalCandidateCount = 0;
  let relocationCount = 0;
  let removalCount = 0;
  let breakingMoveCount = 0;
  let totalFallenPieces = 0;
  let maxFallenPieces = 0;
  let iterationCount = 0;

  while (!areAllAnalysisPiecesSolved(pieceStates)) {
    iterationCount++;
    if (iterationCount > safetyLimit || isAnalysisBudgetExceeded(analysisBudget)) {
      return buildAnalysisResult({
        solved: false,
        timedOut: analysisBudget.timedOut,
        moveCount,
        forcedPlacements,
        ambiguousPlacements,
        maxCandidateCount,
        totalCandidateCount,
        relocationCount,
        removalCount,
        breakingMoveCount,
        totalFallenPieces,
        maxFallenPieces,
        brickCount: targetBricks.length,
        steps,
      });
    }

    const currentBricks = getPlacedAnalysisBricks(pieceStates);
    const nextPlacement = chooseNextAnalysisPlacement(
      pieceStates,
      currentBricks,
      targetViews,
      bounds,
      plateLength,
      plateWidth,
      playerCount,
      analysisBudget
    );

    if (analysisBudget.timedOut) {
      return buildAnalysisResult({
        solved: false,
        timedOut: true,
        moveCount,
        forcedPlacements,
        ambiguousPlacements,
        maxCandidateCount,
        totalCandidateCount,
        relocationCount,
        removalCount,
        breakingMoveCount,
        totalFallenPieces,
        maxFallenPieces,
        brickCount: targetBricks.length,
        steps,
      });
    }

    if (nextPlacement) {
      applyAnalysisPlacement(nextPlacement.piece, nextPlacement.placement);

      moveCount++;
      totalCandidateCount += nextPlacement.candidateCount;
      if (nextPlacement.candidateCount === 1) forcedPlacements++;
      else ambiguousPlacements++;
      if (nextPlacement.candidateCount > maxCandidateCount)
        maxCandidateCount = nextPlacement.candidateCount;

      steps.push({
        type: 'place',
        brickId: nextPlacement.piece.id,
        color: nextPlacement.piece.target.color,
        length: nextPlacement.piece.target.length,
        width: nextPlacement.piece.target.width,
        placement: cloneAnalysisPlacement(nextPlacement.placement),
        target: cloneAnalysisPlacement(nextPlacement.piece.target),
        candidateCount: nextPlacement.candidateCount,
        correctPlacement: isTargetPlacement(nextPlacement.piece, nextPlacement.placement),
        forced: nextPlacement.candidateCount === 1,
      });

      continue;
    }

    const recovery = chooseRecoveryAction(
      pieceStates,
      targetViews,
      bounds,
      plateLength,
      plateWidth,
      playerCount,
      analysisBudget
    );

    if (analysisBudget.timedOut || !recovery) {
      return buildAnalysisResult({
        solved: false,
        timedOut: analysisBudget.timedOut,
        moveCount,
        forcedPlacements,
        ambiguousPlacements,
        maxCandidateCount,
        totalCandidateCount,
        relocationCount,
        removalCount,
        breakingMoveCount,
        totalFallenPieces,
        maxFallenPieces,
        brickCount: targetBricks.length,
        steps,
      });
    }

    moveCount++;
    if (recovery.actionType === 'relocate') relocationCount++;
    if (recovery.actionType === 'remove') removalCount++;
    if (recovery.fallenPieceCount > 0) {
      breakingMoveCount++;
      totalFallenPieces += recovery.fallenPieceCount;
      if (recovery.fallenPieceCount > maxFallenPieces)
        maxFallenPieces = recovery.fallenPieceCount;
    }

    steps.push({
      type: recovery.actionType,
      brickId: recovery.piece.id,
      color: recovery.piece.color,
      length: recovery.piece.length,
      width: recovery.piece.width,
      from: cloneAnalysisPlacement(recovery.from),
      to: cloneAnalysisPlacement(recovery.to),
      fallenPieceCount: recovery.fallenPieceCount,
      fallenPieceIds: recovery.fallenPieceIds,
    });
  }

  return buildAnalysisResult({
    solved: true,
    timedOut: false,
    moveCount,
    forcedPlacements,
    ambiguousPlacements,
    maxCandidateCount,
    totalCandidateCount,
    relocationCount,
    removalCount,
    breakingMoveCount,
    totalFallenPieces,
    maxFallenPieces,
    brickCount: targetBricks.length,
    steps,
  });
}

function createAnalysisPieceStates(targetBricks) {
  const pieceStates = [];

  for (let i = 0; i < targetBricks.length; i++) {
    pieceStates.push({
      id: targetBricks[i].id,
      target: cloneAnalysisPlacement(targetBricks[i]),
      currentPlacement: null,
      failedPlacements: new Set(),
    });
  }

  return pieceStates;
}

function areAllAnalysisPiecesSolved(pieceStates) {
  for (let i = 0; i < pieceStates.length; i++) {
    if (!isAnalysisPieceAtTarget(pieceStates[i])) return false;
  }
  return true;
}

function getPlacedAnalysisBricks(pieceStates) {
  const bricks = [];

  for (let i = 0; i < pieceStates.length; i++) {
    if (pieceStates[i].currentPlacement)
      bricks.push(cloneAnalysisPlacement(pieceStates[i].currentPlacement));
  }

  return bricks;
}

function chooseNextAnalysisPlacement(
  pieceStates, currentBricks, targetViews, bounds,
  plateLength, plateWidth, playerCount, analysisBudget
) {
  let best = null;

  for (let i = 0; i < pieceStates.length; i++) {
    if (isAnalysisBudgetExceeded(analysisBudget)) return null;

    const piece = pieceStates[i];
    if (piece.currentPlacement) continue;

    const placements = findConsistentPlacements(
      piece.target,
      currentBricks,
      targetViews,
      bounds,
      plateLength,
      plateWidth,
      playerCount,
      analysisBudget
    );

    if (analysisBudget.timedOut || !placements) return null;

    const availablePlacements = [];
    for (let j = 0; j < placements.length; j++) {
      const key = analysisPlacementKey(placements[j]);
      if (!piece.failedPlacements.has(key))
        availablePlacements.push(placements[j]);
    }

    if (availablePlacements.length === 0) continue;

    const candidate = {
      piece,
      placement: availablePlacements[0],
      candidateCount: availablePlacements.length,
    };

    if (!best || compareNextAnalysisPlacementCandidate(candidate, best) < 0)
      best = candidate;
  }

  return best;
}

function compareNextAnalysisPlacementCandidate(left, right) {
  if (left.candidateCount !== right.candidateCount)
    return left.candidateCount - right.candidateCount;

  const placementCmp = compareAnalysisPlacement(left.placement, right.placement);
  if (placementCmp !== 0) return placementCmp;

  return compareAnalysisPlacement(left.piece.target, right.piece.target);
}

function applyAnalysisPlacement(pieceState, placement) {
  pieceState.currentPlacement = createAnalysisPlacement(pieceState.target, placement);
}

function chooseRecoveryAction(
  pieceStates, targetViews, bounds,
  plateLength, plateWidth, playerCount, analysisBudget
) {
  const misplacedPieces = [];
  for (let i = 0; i < pieceStates.length; i++) {
    if (isAnalysisBudgetExceeded(analysisBudget)) return null;
    if (isAnalysisPieceMisplaced(pieceStates[i])) misplacedPieces.push(pieceStates[i]);
  }

  if (misplacedPieces.length === 0) return null;

  misplacedPieces.sort(compareRecoveryPieceStates);
  return recoverMisplacedPiece(
    pieceStates,
    misplacedPieces[0],
    misplacedPieces.length === 1,
    targetViews,
    bounds,
    plateLength,
    plateWidth,
    playerCount,
    analysisBudget
  );
}

function recoverMisplacedPiece(
  pieceStates, pieceState, allowRelocate, targetViews, bounds,
  plateLength, plateWidth, playerCount, analysisBudget
) {
  const from = cloneAnalysisPlacement(pieceState.currentPlacement);

  markAnalysisPlacementFailed(pieceState, pieceState.currentPlacement);
  pieceState.currentPlacement = null;

  const fallenPieces = dropUnsupportedAnalysisPieces(pieceStates);
  let to = null;
  let actionType = 'remove';

  if (allowRelocate) {
    const currentBricks = getPlacedAnalysisBricks(pieceStates);
    const placements = findConsistentPlacements(
      pieceState.target,
      currentBricks,
      targetViews,
      bounds,
      plateLength,
      plateWidth,
      playerCount,
      analysisBudget
    );

    if (analysisBudget.timedOut || !placements) return null;

    for (let i = 0; i < placements.length; i++) {
      if (isTargetPlacement(pieceState, placements[i])) {
        to = createAnalysisPlacement(pieceState.target, placements[i]);
        pieceState.currentPlacement = to;
        actionType = 'relocate';
        break;
      }
    }
  }

  return {
    actionType,
    piece: cloneAnalysisPlacement(pieceState.target),
    from,
    to,
    fallenPieceCount: fallenPieces.length,
    fallenPieceIds: fallenPieces,
  };
}

function dropUnsupportedAnalysisPieces(pieceStates) {
  const unsupportedPieces = findUnsupportedAnalysisPieces(pieceStates);
  const fallenPieceIds = [];

  for (let i = 0; i < unsupportedPieces.length; i++) {
    if (isAnalysisPieceMisplaced(unsupportedPieces[i]))
      markAnalysisPlacementFailed(unsupportedPieces[i], unsupportedPieces[i].currentPlacement);
    fallenPieceIds.push(unsupportedPieces[i].id);
    unsupportedPieces[i].currentPlacement = null;
  }

  return fallenPieceIds;
}

function findUnsupportedAnalysisPieces(pieceStates) {
  const placedPieces = [];
  const stableIds = new Set();
  let changed = true;

  for (let i = 0; i < pieceStates.length; i++) {
    if (pieceStates[i].currentPlacement)
      placedPieces.push(pieceStates[i]);
  }

  for (let i = 0; i < placedPieces.length; i++) {
    if (placedPieces[i].currentPlacement.y === 0)
      stableIds.add(placedPieces[i].id);
  }

  while (changed) {
    changed = false;

    for (let i = 0; i < placedPieces.length; i++) {
      const piece = placedPieces[i];
      if (stableIds.has(piece.id) || piece.currentPlacement.y === 0) continue;

      for (let j = 0; j < placedPieces.length; j++) {
        const supportPiece = placedPieces[j];
        if (!stableIds.has(supportPiece.id)) continue;
        if (!isAnalysisPlacementSupportedBy(piece.currentPlacement, supportPiece.currentPlacement)) continue;

        stableIds.add(piece.id);
        changed = true;
        break;
      }
    }
  }

  const unsupportedPieces = [];
  for (let i = 0; i < placedPieces.length; i++) {
    if (!stableIds.has(placedPieces[i].id)) unsupportedPieces.push(placedPieces[i]);
  }

  return unsupportedPieces;
}

function isAnalysisPlacementSupportedBy(placement, supportPlacement) {
  if (!placement || !supportPlacement) return false;
  if (supportPlacement.y !== placement.y - 1) return false;
  return doAnalysisFootprintsOverlap(placement, supportPlacement);
}

function doAnalysisFootprintsOverlap(left, right) {
  const leftXMax = left.x + left.length - 1;
  const rightXMax = right.x + right.length - 1;
  const leftZMax = left.z + left.width - 1;
  const rightZMax = right.z + right.width - 1;

  return left.x <= rightXMax && right.x <= leftXMax && left.z <= rightZMax && right.z <= leftZMax;
}

function compareRecoveryPieceStates(left, right) {
  const placementCmp = compareAnalysisPlacement(left.currentPlacement, right.currentPlacement);
  if (placementCmp !== 0) return placementCmp;
  return left.id - right.id;
}

function isAnalysisPieceAtTarget(pieceState) {
  return !!pieceState.currentPlacement && isTargetPlacement(pieceState, pieceState.currentPlacement);
}

function isAnalysisPieceMisplaced(pieceState) {
  return !!pieceState.currentPlacement && !isTargetPlacement(pieceState, pieceState.currentPlacement);
}

function isTargetPlacement(pieceState, placement) {
  if (!placement) return false;

  return pieceState.target.x === placement.x &&
    pieceState.target.y === placement.y &&
    pieceState.target.z === placement.z &&
    pieceState.target.length === placement.length &&
    pieceState.target.width === placement.width;
}

function createAnalysisPlacement(piece, placement) {
  return placedBrick(
    placement.x,
    placement.y,
    placement.z,
    placement.length,
    placement.width,
    piece.color
  );
}

function cloneAnalysisPlacement(placement) {
  if (!placement) return null;
  return {
    x: placement.x,
    y: placement.y,
    z: placement.z,
    length: placement.length,
    width: placement.width,
    color: placement.color,
  };
}

function markAnalysisPlacementFailed(pieceState, placement) {
  if (!placement || isTargetPlacement(pieceState, placement)) return;
  pieceState.failedPlacements.add(analysisPlacementKey(placement));
}

function computeAnalysisBounds(bricks, plateLength, plateWidth) {
  let xMin = 0, xMax = plateLength - 1;
  let yMax = 0;
  let zMin = 0, zMax = plateWidth - 1;

  for (let i = 0; i < bricks.length; i++) {
    const brick = bricks[i];
    const brickXMax = brick.x + brick.length - 1;
    const brickZMax = brick.z + brick.width - 1;

    if (brick.x < xMin) xMin = brick.x;
    if (brickXMax > xMax) xMax = brickXMax;
    if (brick.y > yMax) yMax = brick.y;
    if (brick.z < zMin) zMin = brick.z;
    if (brickZMax > zMax) zMax = brickZMax;
  }

  return { xMin, xMax, yMin: 0, yMax, zMin, zMax };
}

function buildTargetViews(bricks, playerCount) {
  const views = {};
  for (let playerIndex = 1; playerIndex <= playerCount; playerIndex++)
    views[playerIndex] = buildTargetView(playerIndex, bricks);
  return views;
}

function buildTargetView(playerIndex, bricks) {
  const rays = buildViewRays(bricks, playerIndex);
  const result = new Map();

  for (const entry of rays.entries()) {
    const colors = new Set();
    const cells = entry[1];
    for (let i = 0; i < cells.length; i++)
      colors.add(cells[i].color);
    result.set(entry[0], colors);
  }

  return result;
}

function buildViewSignature(bricks, playerIndex) {
  const visible = new Map();
  const rays = buildViewRays(bricks, playerIndex);

  for (const entry of rays.entries())
    visible.set(entry[0], entry[1][0]);

  return visible;
}

function buildViewRays(bricks, playerIndex) {
  const rays = new Map();

  for (let i = 0; i < bricks.length; i++) {
    const brick = bricks[i];
    for (let dx = 0; dx < brick.length; dx++) {
      for (let dz = 0; dz < brick.width; dz++) {
        const x = brick.x + dx;
        const y = brick.y;
        const z = brick.z + dz;
        const point = projectPointForAnalysis(playerIndex, x, y, z);
        const key = point.h + ',' + point.v;

        if (!rays.has(key)) rays.set(key, []);
        rays.get(key).push({ depth: point.depth, color: brick.color });
      }
    }
  }

  for (const entry of rays.entries())
    entry[1].sort((left, right) => compareAnalysisDepth(playerIndex, left.depth, right.depth));

  return rays;
}

function projectPointForAnalysis(playerIndex, x, y, z) {
  switch (playerIndex) {
    case 1:
      return { h: x, v: y, depth: z };
    case 2:
      return { h: z, v: y, depth: x };
    case 4:
      return { h: z, v: y, depth: x };
    default:
      return { h: x, v: y, depth: z };
  }
}

function isCloserForAnalysis(playerIndex, nextDepth, currentDepth) {
  if (playerIndex === 2) return nextDepth > currentDepth;
  return nextDepth < currentDepth;
}

function compareAnalysisDepth(playerIndex, leftDepth, rightDepth) {
  if (isCloserForAnalysis(playerIndex, leftDepth, rightDepth)) return -1;
  if (isCloserForAnalysis(playerIndex, rightDepth, leftDepth)) return 1;
  return 0;
}

function findConsistentPlacements(piece, currentBricks, targetViews, bounds, plateLength, plateWidth, playerCount, analysisBudget) {
  const occupied = buildOccupiedSet(currentBricks);
  const pegs = buildPlacementPegs(currentBricks, plateLength, plateWidth);
  const placements = [];
  const seen = new Set();
  const orientations =
    piece.length === piece.width
      ? [[piece.length, piece.width]]
      : [[piece.length, piece.width], [piece.width, piece.length]];

  for (const pegKey of pegs) {
    if (isAnalysisBudgetExceeded(analysisBudget)) return null;

    const peg = parseAnalysisKey(pegKey);

    for (let i = 0; i < orientations.length; i++) {
      const orientation = orientations[i];
      const length = orientation[0];
      const width = orientation[1];

      for (let dx = 0; dx < length; dx++) {
        for (let dz = 0; dz < width; dz++) {
          const x0 = peg.x - dx;
          const z0 = peg.z - dz;
          const candidate = {
            x: x0,
            y: peg.y,
            z: z0,
            length,
            width,
            color: piece.color,
          };

          if (!fitsAnalysisBounds(candidate, bounds)) continue;
          if (!canPlaceAnalysisBrick(candidate, occupied)) continue;

          const candidateKey = analysisPlacementKey(candidate);
          if (seen.has(candidateKey)) continue;
          seen.add(candidateKey);

          const nextBricks = currentBricks.concat([candidate]);
          if (isAnalysisBudgetExceeded(analysisBudget)) return null;
          if (!matchesTargetViews(nextBricks, targetViews, playerCount)) continue;

          placements.push(candidate);
        }
      }
    }
  }

  placements.sort(compareAnalysisPlacement);
  return placements;
}

function buildOccupiedSet(bricks) {
  const occupied = new Set();
  for (let i = 0; i < bricks.length; i++) {
    const brick = bricks[i];
    for (let dx = 0; dx < brick.length; dx++) {
      for (let dz = 0; dz < brick.width; dz++)
        occupied.add(vec3Key(brick.x + dx, brick.y, brick.z + dz));
    }
  }
  return occupied;
}

function buildPlacementPegs(bricks, plateLength, plateWidth) {
  const pegs = new Set();

  for (let x = 0; x < plateLength; x++) {
    for (let z = 0; z < plateWidth; z++)
      pegs.add(analysisPegKey(x, 0, z));
  }

  for (let i = 0; i < bricks.length; i++) {
    const brick = bricks[i];
    for (let dx = 0; dx < brick.length; dx++) {
      for (let dz = 0; dz < brick.width; dz++)
        pegs.add(analysisPegKey(brick.x + dx, brick.y + 1, brick.z + dz));
    }
  }

  return pegs;
}

function canPlaceAnalysisBrick(candidate, occupied) {
  for (let dx = 0; dx < candidate.length; dx++) {
    for (let dz = 0; dz < candidate.width; dz++) {
      if (occupied.has(vec3Key(candidate.x + dx, candidate.y, candidate.z + dz)))
        return false;
    }
  }
  return true;
}

function fitsAnalysisBounds(candidate, bounds) {
  if (candidate.y < bounds.yMin || candidate.y > bounds.yMax) return false;
  if (candidate.x < bounds.xMin) return false;
  if (candidate.z < bounds.zMin) return false;
  if (candidate.x + candidate.length - 1 > bounds.xMax) return false;
  if (candidate.z + candidate.width - 1 > bounds.zMax) return false;
  return true;
}

function matchesTargetViews(bricks, targetViews, playerCount) {
  for (let playerIndex = 1; playerIndex <= playerCount; playerIndex++) {
    const currentView = buildViewSignature(bricks, playerIndex);
    const targetView = targetViews[playerIndex];

    for (const entry of currentView.entries()) {
      const key = entry[0];
      const value = entry[1];
      const target = targetView.get(key);
      if (!target || !target.has(value.color)) return false;
    }
  }

  return true;
}

function compareAnalysisCandidate(left, right) {
  if (left.placements.length !== right.placements.length)
    return left.placements.length - right.placements.length;
  if (left.targetIndex !== right.targetIndex)
    return left.targetIndex - right.targetIndex;
  return compareAnalysisPlacement(left.piece, right.piece);
}

function compareAnalysisPlacement(left, right) {
  if (left.y !== right.y) return left.y - right.y;
  if (left.x !== right.x) return left.x - right.x;
  if (left.z !== right.z) return left.z - right.z;
  if (left.length !== right.length) return left.length - right.length;
  if (left.width !== right.width) return left.width - right.width;
  return left.color - right.color;
}

function buildAnalysisResult(data) {
  const brickCount = data.brickCount || 0;
  const moveRatio = brickCount > 0 ? data.moveCount / brickCount : 0;
  const averageCandidateCount = brickCount > 0 ? data.totalCandidateCount / brickCount : 0;
  const ambiguityRatio = brickCount > 0 ? data.ambiguousPlacements / brickCount : 0;
  const solverStatus = data.timedOut ? 'Timed out' : (data.solved ? 'Solved' : 'Unresolved');

  return {
    solved: data.solved,
    timedOut: !!data.timedOut,
    solverStatus,
    brickCount,
    moveCount: data.moveCount,
    moveRatio,
    forcedPlacements: data.forcedPlacements,
    ambiguousPlacements: data.ambiguousPlacements,
    maxCandidateCount: data.maxCandidateCount,
    averageCandidateCount,
    relocationCount: data.relocationCount,
    removalCount: data.removalCount,
    breakingMoveCount: data.breakingMoveCount,
    totalFallenPieces: data.totalFallenPieces,
    maxFallenPieces: data.maxFallenPieces,
    classification: classifyPuzzleAnalysis(
      data.solved,
      moveRatio,
      data.maxCandidateCount,
      averageCandidateCount,
      ambiguityRatio
    ),
    steps: data.steps,
  };
}

function classifyPuzzleAnalysis(solved, moveRatio, maxCandidateCount, averageCandidateCount, ambiguityRatio) {
  if (!solved) return 'Unresolved';

  if (moveRatio <= 1.25 && averageCandidateCount <= 1.4 && maxCandidateCount <= 2 && ambiguityRatio <= 0.25)
    return 'Easy';

  if (moveRatio <= 2.2 && averageCandidateCount <= 2.4 && maxCandidateCount <= 5 && ambiguityRatio <= 0.55)
    return 'Medium';

  if (moveRatio <= 4.25 && averageCandidateCount <= 5.0 && maxCandidateCount <= 16 && ambiguityRatio <= 0.85)
    return 'Hard';

  return 'Very hard';
}

function isAnalysisBudgetExceeded(analysisBudget) {
  if (!analysisBudget) return false;
  if (analysisBudget.timedOut) return true;
  if (Date.now() <= analysisBudget.deadlineMs) return false;
  analysisBudget.timedOut = true;
  return true;
}

function analysisPegKey(x, y, z) {
  return x + ',' + y + ',' + z;
}

function parseAnalysisKey(key) {
  const parts = key.split(',');
  return {
    x: parseInt(parts[0], 10),
    y: parseInt(parts[1], 10),
    z: parseInt(parts[2], 10),
  };
}

function analysisPlacementKey(placement) {
  return [placement.x, placement.y, placement.z, placement.length, placement.width, placement.color].join(',');
}