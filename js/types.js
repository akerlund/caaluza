// ---------------------------------------------------------------------------
// Shared data types mirroring the C# structs.
// ---------------------------------------------------------------------------

const BrickColor = Object.freeze({
  Yellow: 0,
  Red:    1,
  Green:  2,
  Blue:   3,
});

function brickShape(length, width, color) {
  return { length, width, color };
}

function placedBrick(x, y, z, length, width, color) {
  return { x, y, z, length, width, color };
}

// Lightweight int-vector key for Set/Map lookups (avoid object identity).
function vec3Key(x, y, z) {
  // Supports coordinates roughly –512..511 per axis — more than enough.
  return ((x + 512) << 20) | ((y + 512) << 10) | (z + 512);
}

function vec3From(x, y, z) { return { x, y, z }; }
