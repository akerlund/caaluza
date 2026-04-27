# Map Categorization Through Estimated Solve Moves

## Goal

Categorize a generated puzzle by estimating how many moves a solver needs to
finish it from the shared blueprints.

The first useful metric is not the raw block count. A puzzle with 12 blocks can
still be much harder than another 12-block puzzle if several placements stay
valid for a long time.

## State We Track

For a puzzle with 2 to 4 players we keep these values:

- the target brick layout
- the current partial build
- the remaining bricks
- the active player views
- the list of valid placements for each remaining brick

## Important Visibility Rule

The current partial build must not contradict any player blueprint.

This is slightly more subtle than comparing against the final visible image.
A brick that is visible now may be hidden later by another brick. Because of
that, a placement is allowed when its visible cells belong to the target view
ray for that player, even if that brick is not the final front-most or top-most
brick in that ray.

## Current Solver Version

The current implementation now keeps a real build state instead of only counting
candidate positions on paper.

1. Start from an empty build.
2. For every unplaced brick, enumerate all placements that:
  - are physically placeable on the plate or on existing studs
  - stay within the target puzzle bounds
  - do not contradict any active blueprint ray
3. Pick the most constrained unplaced brick.
  - "Most constrained" means the brick with the fewest currently valid
    placements.
4. Place that brick at the first still-untried valid position.
  - this position may be the correct target position
  - or it may be a wrong position that still looks valid from every blueprint
5. Keep building while the partial model still allows further placements.
6. When the build gets stuck, recover by correcting misplaced bricks:
  - if exactly one misplaced brick remains, try to relocate it directly to its
    target position
  - otherwise remove the lowest misplaced brick and continue
7. After a move or removal, check support chains.
  - any brick that is no longer connected to the ground through supporting
    bricks falls out of the construction and becomes unplaced again
8. Repeat until every brick reaches its target position or the solver can no
  longer make progress.

If the solver exceeds its safety limit or cannot find either a valid placement
or a valid recovery move, the puzzle is marked as unresolved.

## Relation To The Original State Machine Idea

The original idea was:

- if the current build matches the blueprints, add a block
- if one block does not fit, move it if possible, otherwise remove it
- if several blocks do not fit, first remove blocks with the wrong color, then
  remove the lowest block

This is still a heuristic, but it is now much closer to the original state
machine because it keeps wrong placements in the world until the solver has to
repair them.

## Metrics Produced Per Puzzle

- estimated moves
- forced placements
- ambiguous placements
- relocations
- removals
- breaking moves
- total fallen pieces
- largest single fall
- move ratio = estimated moves / brick count
- max candidate count for a single step
- average candidate count across the solve
- difficulty label

## Current Difficulty Labels

- Easy: low move ratio and almost no branching
- Medium: some ambiguity, but still mostly constrained
- Hard: repeated ambiguous placements
- Very hard: high ambiguity or many trial moves
- Unresolved: the heuristic solver could not complete the puzzle

## Why This Helps Categorization

This gives us a score that reflects deduction pressure instead of only geometry.

- more forced placements usually means easier puzzles
- more candidate placements usually means harder puzzles
- the move ratio lets us compare puzzles with different brick counts

## Next Iteration

If we want to get closer to the original state machine, the next step is to let
the solver actually place incorrect blocks, then apply explicit move/remove
recovery rules when later blueprint checks fail.
